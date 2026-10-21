"""
Playwright Browser Automation Service.
비표준 레거시 웹(중첩 iframe, 독자 JS UI), SPA 동적 탭, 마우스 비점유 백그라운드(Headless/최소화) 실행,
그리고 AI 에이전트 전용 고신뢰도 DOM 스냅샷(ref ID) 제어를 담당하는 핵심 브라우저 서비스입니다.
"""

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

BROWSER_PROFILE_DIR = settings.STORAGE_DIR / "browser_profile"
BROWSER_DOWNLOAD_DIR = settings.STORAGE_DIR / "downloads"
BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
BROWSER_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


# 브라우저 DOM에서 깔끔한 마크다운(표/제목/본문)을 추출하는 헬퍼 스크립트
EXTRACT_MARKDOWN_JS = """
(rootSelector) => {
    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (!root) return "";

    const clone = root.cloneNode(true);
    const removeTags = ['script', 'style', 'noscript', 'svg', 'path', 'head', 'meta', 'link'];
    for (const tag of removeTags) {
        clone.querySelectorAll(tag).forEach(el => el.remove());
    }

    // 표(table)를 마크다운 테이블로 변환
    clone.querySelectorAll('table').forEach(table => {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length === 0) return;
        const mdRows = [];
        rows.forEach((tr, rIdx) => {
            const cells = Array.from(tr.querySelectorAll('th, td')).map(c =>
                (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim().replace(/\\|/g, '\\\\|')
            );
            if (cells.some(c => c.length > 0)) {
                mdRows.push('| ' + cells.join(' | ') + ' |');
                if (rIdx === 0) {
                    mdRows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
                }
            }
        });
        const pre = document.createElement('div');
        pre.textContent = '\\n' + mdRows.join('\\n') + '\\n';
        table.replaceWith(pre);
    });

    // 제목 태그 변환
    ['h1', 'h2', 'h3', 'h4'].forEach((hTag, idx) => {
        const prefix = '#'.repeat(idx + 1) + ' ';
        clone.querySelectorAll(hTag).forEach(h => {
            const txt = (h.innerText || h.textContent || '').trim();
            if (txt) {
                h.textContent = '\\n' + prefix + txt + '\\n';
            }
        });
    });

    const rawText = clone.innerText || clone.textContent || '';
    return rawText
        .split('\\n')
        .map(line => line.trim())
        .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
        .join('\\n')
        .trim();
}
"""

# 에이전트용 인터랙티브 요소 스캔 및 고유 data-pm-ref 속성 부여 스크립트
SCAN_INTERACTIVE_ELEMENTS_JS = """
(args) => {
    const { startRefIndex, query, maxLimit } = args;
    const selector = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="checkbox"]',
        '[role="combobox"]',
        '[contenteditable="true"]',
        '[onclick]'
    ].join(', ');

    const nodes = Array.from(document.querySelectorAll(selector));
    const results = [];
    let refCounter = startRefIndex;
    const qLower = (query || '').trim().toLowerCase();

    for (const el of nodes) {
        if (results.length >= maxLimit) break;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            continue;
        }
        if (rect.width < 3 || rect.height < 3) {
            continue;
        }

        const tag = el.tagName.toLowerCase();
        const typeAttr = (el.getAttribute('type') || '').toLowerCase();
        const role = el.getAttribute('role') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const titleAttr = el.getAttribute('title') || '';
        const nameAttr = el.getAttribute('name') || '';
        const idAttr = el.id || '';
        const val = (el.value !== undefined && typeof el.value === 'string') ? el.value.trim() : '';
        const innerTxt = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();

        const label = (innerTxt || ariaLabel || placeholder || titleAttr || val || nameAttr || idAttr).slice(0, 80);
        if (!label && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
            continue;
        }

        if (qLower) {
            const combined = `${label} ${placeholder} ${ariaLabel} ${nameAttr} ${idAttr} ${val}`.toLowerCase();
            if (!combined.includes(qLower)) continue;
        }

        const refId = `e${refCounter++}`;
        el.setAttribute('data-pm-ref', refId);

        let cssHint = tag;
        if (idAttr && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(idAttr)) {
            cssHint = `#${idAttr}`;
        } else if (nameAttr) {
            cssHint = `${tag}[name="${nameAttr.replace(/"/g, '\\\\"')}"]`;
        } else if (placeholder) {
            cssHint = `${tag}[placeholder="${placeholder.slice(0, 30).replace(/"/g, '\\\\"')}"]`;
        }

        results.push({
            ref: refId,
            tag: tag,
            type: typeAttr || role || tag,
            label: label || '(입력창)',
            placeholder: placeholder,
            value: val.slice(0, 40),
            selector_hint: cssHint
        });
    }

    return { items: results, nextIndex: refCounter };
}
"""

# 브라우저 내부에 주입되는 비주얼 웹 요소 선택기(Web Picker) 스크립트
WEB_PICKER_INJECT_JS = """
(initialMode) => {
    if (!document || !document.documentElement) {
        return { status: 'no_dom', mode: initialMode || 'pick' };
    }
    if (window.__pm_picker_injected) {
        if (initialMode && window !== window.top) {
            window.__pm_picker_mode = initialMode;
            if (initialMode !== 'pick') {
                const hb = document.getElementById('__pm_picker_highlight_box');
                const tt = document.getElementById('__pm_picker_tooltip');
                if (hb) hb.style.display = 'none';
                if (tt) tt.style.display = 'none';
            }
        }
        return { status: 'already_injected', mode: window.__pm_picker_mode || 'pick' };
    }

    window.__pm_picker_injected = true;
    window.__pm_picker_mode = initialMode || 'pick';
    window.__pm_picker_result = null;

    const isTopFrame = (window === window.top);
    const inIframe = !isTopFrame;

    // 1. 최적 CSS Selector 생성 함수
    function cssEscapeIdent(str) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(str);
        }
        return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\]^`{|}~])/g, '\\\\$1');
    }

    function isUniqueCss(sel) {
        try {
            return document.querySelectorAll(sel).length === 1;
        } catch (e) {
            return false;
        }
    }

    function getOptimalCssSelector(el) {
        if (!el || el.nodeType !== 1) return '';
        const tag = el.tagName.toLowerCase();

        // 1순위: 고유 ID
        if (el.id && typeof el.id === 'string' && el.id.trim() !== '') {
            const idSel = '#' + cssEscapeIdent(el.id.trim());
            if (isUniqueCss(idSel)) return idSel;
        }

        // 2순위: 핵심 고유 속성 (data-testid, name, placeholder, aria-label, title)
        const attrCandidates = ['data-testid', 'data-id', 'data-qa', 'name', 'placeholder', 'aria-label', 'title'];
        for (const attr of attrCandidates) {
            const val = el.getAttribute(attr);
            if (val && val.trim().length > 0 && val.trim().length <= 60 && !val.includes('"') && !val.includes('\\n')) {
                const candidate = `${tag}[${attr}="${val.trim()}"]`;
                if (isUniqueCss(candidate)) return candidate;
            }
        }

        // 3순위: 의미 있는 클래스 조합
        if (el.classList && el.classList.length > 0) {
            const cleanClasses = Array.from(el.classList).filter(
                c => /^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/.test(c) && !c.startsWith('pm-picker')
            ).slice(0, 3);
            if (cleanClasses.length > 0) {
                const classSel = tag + '.' + cleanClasses.map(cssEscapeIdent).join('.');
                if (isUniqueCss(classSel)) return classSel;
            }
        }

        // 4순위: 상위 부모 계층 추적 경로 (최대 5단계)
        const parts = [];
        let curr = el;
        let depth = 0;
        while (curr && curr.nodeType === 1 && curr !== document.body && curr !== document.documentElement && depth < 5) {
            const cTag = curr.tagName.toLowerCase();
            if (curr.id && typeof curr.id === 'string' && curr.id.trim() !== '') {
                const idPart = '#' + cssEscapeIdent(curr.id.trim());
                parts.unshift(idPart);
                const candidatePath = parts.join(' > ');
                if (isUniqueCss(candidatePath)) return candidatePath;
                break;
            }

            let part = cTag;
            const parent = curr.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(ch => ch.tagName === curr.tagName);
                if (siblings.length > 1) {
                    const idx = siblings.indexOf(curr) + 1;
                    part = `${cTag}:nth-of-type(${idx})`;
                }
            }
            parts.unshift(part);
            const candidatePath = parts.join(' > ');
            if (isUniqueCss(candidatePath)) return candidatePath;

            curr = parent;
            depth++;
        }

        return parts.join(' > ') || tag;
    }

    function getXPath(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id && typeof el.id === 'string' && el.id.trim() !== '' && !el.id.includes('"')) {
            return `//*[@id="${el.id.trim()}"]`;
        }
        const parts = [];
        let curr = el;
        while (curr && curr.nodeType === 1 && curr.tagName.toLowerCase() !== 'html') {
            const tag = curr.tagName.toLowerCase();
            if (curr.id && typeof curr.id === 'string' && curr.id.trim() !== '' && !curr.id.includes('"')) {
                parts.unshift(`//*[@id="${curr.id.trim()}"]`);
                return parts.join('/');
            }
            let idx = 1;
            let sib = curr.previousElementSibling;
            while (sib) {
                if (sib.tagName === curr.tagName) idx++;
                sib = sib.previousElementSibling;
            }
            parts.unshift(`${tag}[${idx}]`);
            curr = curr.parentElement;
        }
        return '//' + parts.join('/');
    }

    function extractElementMeta(el) {
        // 버튼이나 링크 안의 작은 아이콘(span/svg/i)을 찍었을 경우 가장 가까운 클릭/입력 부모로 보정
        const interactiveAncestor = el.closest('button, a, input, textarea, select, [role="button"], [role="link"], [role="tab"], label');
        const targetEl = interactiveAncestor || el;

        const tag = targetEl.tagName.toLowerCase();
        const typeAttr = (targetEl.getAttribute('type') || '').toLowerCase();
        const roleAttr = targetEl.getAttribute('role') || '';
        const placeholder = (targetEl.getAttribute('placeholder') || '').trim();
        const ariaLabel = (targetEl.getAttribute('aria-label') || '').trim();
        const nameAttr = (targetEl.getAttribute('name') || '').trim();
        const idAttr = (targetEl.id || '').trim();
        const rawText = (targetEl.innerText || targetEl.textContent || '').replace(/\\s+/g, ' ').trim();
        const shortText = rawText.slice(0, 60);

        const cssSelector = getOptimalCssSelector(targetEl);
        const xpathSelector = getXPath(targetEl);

        let recType = 'css';
        let recSelector = cssSelector;

        const isInputLike = ['input', 'textarea', 'select'].includes(tag) || targetEl.isContentEditable;
        if (isInputLike) {
            if (idAttr && cssSelector.startsWith('#')) {
                recType = 'css';
                recSelector = cssSelector;
            } else if (placeholder && placeholder.length <= 40) {
                recType = 'placeholder';
                recSelector = placeholder;
            } else {
                recType = 'css';
                recSelector = cssSelector;
            }
        } else {
            if (idAttr && cssSelector.startsWith('#')) {
                recType = 'css';
                recSelector = cssSelector;
            } else if (['button', 'a'].includes(tag) && shortText.length >= 1 && shortText.length <= 25) {
                recType = 'css';
                recSelector = cssSelector;
            }
        }

        const displayName = shortText || placeholder || ariaLabel || nameAttr || (idAttr ? `#${idAttr}` : `<${tag}>`);

        return {
            tag: tag,
            input_type: typeAttr,
            role: roleAttr,
            id: idAttr,
            name: nameAttr,
            text: shortText,
            placeholder: placeholder,
            aria_label: ariaLabel,
            display_name: displayName.slice(0, 50),
            css_selector: cssSelector,
            xpath: xpathSelector,
            recommended_type: recType,
            recommended_selector: recSelector,
            in_iframe: inIframe,
            frame_url: window.location.href
        };
    }

    // 2. 하이라이트 오버레이 박스 & 툴팁 생성
    const highlightBox = document.createElement('div');
    highlightBox.id = '__pm_picker_highlight_box';
    Object.assign(highlightBox.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483645',
        border: '2.5px solid #06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.16)',
        borderRadius: '4px',
        boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.5), 0 0 12px rgba(6, 182, 212, 0.45)',
        transition: 'all 0.04s ease-out',
        display: 'none'
    });

    const tooltip = document.createElement('div');
    tooltip.id = '__pm_picker_tooltip';
    Object.assign(tooltip.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483646',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        border: '1px solid #06b6d4',
        borderRadius: '6px',
        padding: '5px 9px',
        fontSize: '12px',
        fontFamily: 'Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
        whiteSpace: 'nowrap',
        maxWidth: '420px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'none'
    });

    document.documentElement.appendChild(highlightBox);
    document.documentElement.appendChild(tooltip);

    // 3. 최상위 프레임(Main Frame)에 상단 플로팅 컨트롤 바 생성
    let banner = null;
    let modeBtn = null;
    if (isTopFrame) {
        banner = document.createElement('div');
        banner.id = '__pm_picker_banner';
        Object.assign(banner.style, {
            position: 'fixed',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '2147483647',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#f8fafc',
            border: '1.5px solid #06b6d4',
            borderRadius: '9999px',
            padding: '7px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
            fontFamily: 'Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            userSelect: 'none'
        });

        const titleSpan = document.createElement('span');
        titleSpan.style.fontWeight = '700';
        titleSpan.style.color = '#22d3ee';
        titleSpan.textContent = '🎯 웹 요소 선택기';

        modeBtn = document.createElement('button');
        modeBtn.type = 'button';
        Object.assign(modeBtn.style, {
            border: 'none',
            borderRadius: '9999px',
            padding: '4px 12px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.15s'
        });

        const updateModeBtnUI = () => {
            if (window.__pm_picker_mode === 'pick') {
                modeBtn.textContent = '🎯 현재: 클릭 시 요소 즉시 선택 (클릭하여 일반 조작 전환)';
                modeBtn.style.backgroundColor = '#0891b2';
                modeBtn.style.color = '#ffffff';
            } else {
                modeBtn.textContent = '🖐️ 현재: 일반 브라우저 조작 중 (클릭하여 요소 선택 모드로 전환)';
                modeBtn.style.backgroundColor = '#d97706';
                modeBtn.style.color = '#ffffff';
                highlightBox.style.display = 'none';
                tooltip.style.display = 'none';
            }
        };
        updateModeBtnUI();

        modeBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            window.__pm_picker_mode = (window.__pm_picker_mode === 'pick') ? 'navigate' : 'pick';
            updateModeBtnUI();
        }, true);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕ 취소 (ESC)';
        Object.assign(cancelBtn.style, {
            backgroundColor: '#334155',
            color: '#cbd5e1',
            border: 'none',
            borderRadius: '9999px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer'
        });
        cancelBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            window.__pm_picker_result = { status: 'cancelled' };
        }, true);

        banner.appendChild(titleSpan);
        banner.appendChild(modeBtn);
        banner.appendChild(cancelBtn);
        document.documentElement.appendChild(banner);
    }

    function isPickerUiElement(el) {
        if (!el) return false;
        if (el.id && el.id.startsWith('__pm_picker_')) return true;
        if (el.closest && el.closest('#__pm_picker_banner')) return true;
        return false;
    }

    function onMouseMove(e) {
        if (window.__pm_picker_mode !== 'pick') {
            highlightBox.style.display = 'none';
            tooltip.style.display = 'none';
            return;
        }
        const rawEl = document.elementFromPoint(e.clientX, e.clientY);
        if (
            !rawEl ||
            isPickerUiElement(rawEl) ||
            rawEl === document.body ||
            rawEl === document.documentElement ||
            rawEl.tagName === 'IFRAME' ||
            rawEl.tagName === 'FRAME'
        ) {
            highlightBox.style.display = 'none';
            tooltip.style.display = 'none';
            return;
        }

        const targetEl = rawEl.closest('button, a, input, textarea, select, [role="button"], [role="link"], [role="tab"], label') || rawEl;
        const rect = targetEl.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
            highlightBox.style.display = 'none';
            tooltip.style.display = 'none';
            return;
        }

        highlightBox.style.display = 'block';
        highlightBox.style.left = `${rect.left}px`;
        highlightBox.style.top = `${rect.top}px`;
        highlightBox.style.width = `${rect.width}px`;
        highlightBox.style.height = `${rect.height}px`;

        const meta = extractElementMeta(targetEl);
        const iframeBadge = meta.in_iframe ? '[iframe] ' : '';
        tooltip.textContent = `${iframeBadge}<${meta.tag}> ${meta.display_name}  ➔  ${meta.css_selector}`;
        tooltip.style.display = 'block';

        let tipTop = rect.top - 32;
        if (tipTop < 48) tipTop = rect.bottom + 6;
        let tipLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 380));
        tooltip.style.top = `${tipTop}px`;
        tooltip.style.left = `${tipLeft}px`;
    }

    function onClick(e) {
        if (isPickerUiElement(e.target)) return;
        if (window.__pm_picker_mode !== 'pick') return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const rawEl = document.elementFromPoint(e.clientX, e.clientY) || e.target;
        const meta = extractElementMeta(rawEl);

        highlightBox.style.borderColor = '#10b981';
        highlightBox.style.backgroundColor = 'rgba(16, 185, 129, 0.28)';
        tooltip.style.borderColor = '#10b981';
        tooltip.textContent = `✅ 선택 완료: ${meta.display_name} (${meta.css_selector})`;

        window.__pm_picker_result = {
            status: 'picked',
            element: meta
        };
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            window.__pm_picker_result = { status: 'cancelled' };
        }
    }

    function onMouseOut(e) {
        if (!e.relatedTarget) {
            highlightBox.style.display = 'none';
            tooltip.style.display = 'none';
        }
    }

    window.__pm_picker_cleanup = () => {
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('mouseout', onMouseOut, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('mousedown', onBlockMouseDown, true);
        window.removeEventListener('keydown', onKeyDown, true);
        highlightBox.remove();
        tooltip.remove();
        if (banner) banner.remove();
        window.__pm_picker_injected = false;
    };

    function onBlockMouseDown(e) {
        if (isPickerUiElement(e.target)) return;
        if (window.__pm_picker_mode === 'pick') {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseout', onMouseOut, true);
    window.addEventListener('mousedown', onBlockMouseDown, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);

    return { status: 'injected', mode: window.__pm_picker_mode };
}
"""

CLEANUP_WEB_PICKER_JS = """
() => {
    if (typeof window.__pm_picker_cleanup === 'function') {
        try { window.__pm_picker_cleanup(); } catch (e) {}
    }
    window.__pm_picker_injected = false;
    window.__pm_picker_result = null;
}
"""


class PlaywrightService:
    """
    Playwright 브라우저 컨텍스트 및 탭(Page) 수명주기를 관리하는 싱글톤 서비스.
    - 설치된 Chrome / Edge 채널 자동 감지 및 Persistent Profile 지원
    - 일반 창(headed) / 최소화(minimized) / 완전 백그라운드(headless) 모드 지원
    - 중첩 iframe 자동 관통 탐색 및 에이전트용 ref 스냅샷 제공
    """

    def __init__(self) -> None:
        self._playwright = None
        self._browser = None
        self._context = None
        self._current_page = None
        self._context_closed: bool = False
        self._current_config: Dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._last_downloaded_file: Optional[str] = None
        self._picker_active: bool = False
        self._picker_status: str = "idle"
        self._picker_result: Optional[Dict[str, Any]] = None
        self._picker_error: Optional[str] = None
        self._picker_task: Optional[asyncio.Task] = None

    def _is_context_alive(self) -> bool:
        if self._context is None or self._context_closed:
            return False
        if self._browser is not None:
            try:
                if not self._browser.is_connected():
                    return False
            except Exception:
                return False
        try:
            pages = [p for p in self._context.pages if not p.is_closed()]
            # 열린 탭(창)이 0개이면 사용자가 브라우저 창을 닫아 세션이 종료된 상태이므로 재실행 필요
            if len(pages) == 0:
                return False
            return True
        except Exception:
            return False

    async def ensure_page(
        self,
        run_mode: str = "headed",
        browser_channel: str = "chrome",
        use_persistent_profile: bool = True,
        new_tab: bool = False,
    ):
        """
        활성화된 Playwright Page 객체를 반환합니다.
        사용자가 이전 실행 후 브라우저 창을 닫았거나(Target page, context or browser has been closed),
        실행 모드가 변경된 경우 자동으로 세션을 정리하고 새 브라우저를 재실행합니다.
        """
        async with self._lock:
            norm_mode = (run_mode or "headed").strip().lower()
            norm_channel = (browser_channel or "chrome").strip().lower()
            is_headless = norm_mode == "headless"

            need_relaunch = not self._is_context_alive()
            if not need_relaunch and self._current_config:
                if self._current_config.get("is_headless") != is_headless:
                    need_relaunch = True

            if need_relaunch:
                await self._close_unlocked()
                await self._launch_unlocked(
                    run_mode=norm_mode,
                    browser_channel=norm_channel,
                    use_persistent_profile=use_persistent_profile,
                )

            # 기존 컨텍스트에서 페이지 획득 또는 새 탭 생성 시도 (죽은 컨텍스트 감지 시 즉시 재실행 복구)
            try:
                if self._context is None:
                    raise RuntimeError("Context is None")

                pages = [p for p in self._context.pages if not p.is_closed()]
                if new_tab or not pages:
                    page = await self._context.new_page()
                    self._attach_page_listeners(page)
                    self._current_page = page
                else:
                    if self._current_page is None or self._current_page.is_closed() or self._current_page not in pages:
                        self._current_page = pages[-1]
                    page = self._current_page

                # 실제 브라우저 프로세스와의 IPC 연결이 살아있는지 경량 검증
                await page.title()
                return page
            except Exception as err:
                logger.warning(f"Existing browser context/page was closed ({err}). Relaunching fresh browser session...")
                await self._close_unlocked()
                await self._launch_unlocked(
                    run_mode=norm_mode,
                    browser_channel=norm_channel,
                    use_persistent_profile=use_persistent_profile,
                )
                if self._context is None:
                    raise RuntimeError("Playwright 브라우저 컨텍스트를 재초기화할 수 없습니다.")
                pages = [p for p in self._context.pages if not p.is_closed()]
                if pages:
                    self._current_page = pages[-1]
                else:
                    self._current_page = await self._context.new_page()
                    self._attach_page_listeners(self._current_page)
                return self._current_page

    def _attach_page_listeners(self, page: Any) -> None:
        """새 탭(팝업) 열림 및 다운로드 이벤트를 자동 추적합니다."""
        try:
            def _on_popup(popup_page):
                self._current_page = popup_page
                self._attach_page_listeners(popup_page)

            page.on("popup", _on_popup)
        except Exception as e:
            logger.debug(f"Failed to attach popup listener: {e}")

    def _attach_context_listeners(self, context: Any, browser: Any = None) -> None:
        """컨텍스트 또는 브라우저가 사용자에 의해 닫힐 때 즉시 감지합니다."""
        self._context_closed = False

        def _mark_closed(*_):
            self._context_closed = True

        try:
            context.on("close", _mark_closed)
        except Exception:
            pass
        if browser is not None:
            try:
                browser.on("disconnected", _mark_closed)
            except Exception:
                pass

    async def _launch_unlocked(
        self,
        run_mode: str,
        browser_channel: str,
        use_persistent_profile: bool,
    ) -> None:
        from playwright.async_api import async_playwright

        self._playwright = await async_playwright().start()
        is_headless = run_mode == "headless"

        args = [
            "--disable-blink-features=AutomationControlled",
            "--no-default-browser-check",
            "--no-first-run",
            "--disable-background-mode",
            "--disable-backgrounding-occluded-windows",
        ]
        if run_mode == "minimized" and not is_headless:
            args.append("--start-minimized")

        # 시도할 채널 우선순위 (사용자 지정 -> chrome -> msedge -> 기본 chromium)
        channels_to_try: List[Optional[str]] = []
        if browser_channel in ("chrome", "msedge"):
            channels_to_try.append(browser_channel)
        for fallback_ch in ("chrome", "msedge", None):
            if fallback_ch not in channels_to_try:
                channels_to_try.append(fallback_ch)

        last_err: Optional[Exception] = None
        for ch in channels_to_try:
            try:
                launch_kwargs: Dict[str, Any] = {
                    "headless": is_headless,
                    "args": args,
                    "accept_downloads": True,
                }
                if ch:
                    launch_kwargs["channel"] = ch

                context_viewport_kwargs: Dict[str, Any] = (
                    {"viewport": {"width": 1920, "height": 1080}}
                    if is_headless
                    else {"no_viewport": True}
                )

                if use_persistent_profile:
                    profile_path = BROWSER_PROFILE_DIR / (ch or "chromium")
                    profile_path.mkdir(parents=True, exist_ok=True)
                    try:
                        self._context = await self._playwright.chromium.launch_persistent_context(
                            user_data_dir=str(profile_path),
                            **context_viewport_kwargs,
                            **launch_kwargs,
                        )
                        self._browser = None
                        self._attach_context_listeners(self._context, None)
                        # 영구 프로필 컨텍스트가 즉시 닫히지 않았는지 실제 페이지 생성/접근으로 즉시 검증
                        live_pages = [p for p in self._context.pages if not p.is_closed()]
                        if not live_pages:
                            test_page = await self._context.new_page()
                            live_pages = [test_page]
                        await live_pages[-1].title()
                    except Exception as persistent_err:
                        logger.warning(f"Persistent profile launch/verify failed ({persistent_err}), falling back to standard context.")
                        try:
                            if self._context is not None:
                                await self._context.close()
                        except Exception:
                            pass
                        browser_kwargs = {k: v for k, v in launch_kwargs.items() if k != "accept_downloads"}
                        self._browser = await self._playwright.chromium.launch(**browser_kwargs)
                        self._context = await self._browser.new_context(
                            accept_downloads=True,
                            **context_viewport_kwargs,
                        )
                        self._attach_context_listeners(self._context, self._browser)
                        init_page = await self._context.new_page()
                        await init_page.title()
                else:
                    browser_kwargs = {k: v for k, v in launch_kwargs.items() if k != "accept_downloads"}
                    self._browser = await self._playwright.chromium.launch(**browser_kwargs)
                    self._context = await self._browser.new_context(
                        accept_downloads=True,
                        **context_viewport_kwargs,
                    )
                    self._attach_context_listeners(self._context, self._browser)
                    init_page = await self._context.new_page()
                    await init_page.title()

                self._current_config = {
                    "run_mode": run_mode,
                    "is_headless": is_headless,
                    "browser_channel": ch or "chromium",
                    "use_persistent_profile": use_persistent_profile,
                }
                for p in self._context.pages:
                    self._attach_page_listeners(p)
                live_pages = [p for p in self._context.pages if not p.is_closed()]
                if live_pages:
                    self._current_page = live_pages[-1]
                return
            except Exception as e:
                last_err = e
                logger.debug(f"Playwright channel '{ch}' launch failed: {e}")

        raise RuntimeError(
            f"브라우저를 실행할 수 없습니다. PC에 Chrome 또는 Edge가 설치되어 있는지 확인해 주세요. (원인: {last_err})"
        )

    async def _close_unlocked(self) -> None:
        self._context_closed = True
        try:
            if self._context is not None:
                await self._context.close()
        except Exception:
            pass
        try:
            if self._browser is not None:
                await self._browser.close()
        except Exception:
            pass
        try:
            if self._playwright is not None:
                await self._playwright.stop()
        except Exception:
            pass
        self._context = None
        self._browser = None
        self._playwright = None
        self._current_page = None
        self._current_config = {}

    async def close(self) -> None:
        """열려 있는 Playwright 브라우저 세션을 안전하게 종료합니다."""
        async with self._lock:
            await self._close_unlocked()

    async def get_active_page(self):
        """현재 활성 탭(Page)을 반환하며, 탭이나 창이 닫혔을 경우 자동으로 새 세션을 복구합니다."""
        if not self._is_context_alive():
            return await self.ensure_page(
                run_mode=self._current_config.get("run_mode", "headed"),
                browser_channel=self._current_config.get("browser_channel", "chrome"),
                use_persistent_profile=self._current_config.get("use_persistent_profile", True),
            )
        try:
            pages = [p for p in self._context.pages if not p.is_closed()]
            if not pages:
                return await self.ensure_page()
            if self._current_page not in pages or self._current_page.is_closed():
                self._current_page = pages[-1]
            await self._current_page.title()
            return self._current_page
        except Exception:
            return await self.ensure_page(
                run_mode=self._current_config.get("run_mode", "headed"),
                browser_channel=self._current_config.get("browser_channel", "chrome"),
                use_persistent_profile=self._current_config.get("use_persistent_profile", True),
            )

    async def navigate(
        self,
        url: str,
        run_mode: str = "headed",
        browser_channel: str = "chrome",
        use_persistent_profile: bool = True,
        new_tab: bool = False,
        wait_until: str = "domcontentloaded",
        timeout_sec: float = 15.0,
    ) -> Dict[str, Any]:
        """지정한 URL로 이동하고 페이지 제목 및 최종 URL을 반환합니다."""
        clean_url = (url or "").strip()
        if not clean_url:
            raise ValueError("이동할 웹 주소(URL)가 비어 있습니다.")
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", clean_url) and not clean_url.startswith("about:"):
            clean_url = "https://" + clean_url

        page = await self.ensure_page(
            run_mode=run_mode,
            browser_channel=browser_channel,
            use_persistent_profile=use_persistent_profile,
            new_tab=new_tab,
        )

        valid_wait = wait_until if wait_until in ("load", "domcontentloaded", "networkidle", "commit") else "domcontentloaded"
        timeout_ms = max(1000.0, float(timeout_sec) * 1000.0)

        try:
            await page.goto(clean_url, wait_until=valid_wait, timeout=timeout_ms)
        except Exception as goto_err:
            err_str = str(goto_err)
            if "has been closed" in err_str or "TargetClosed" in err_str or "context or browser" in err_str:
                logger.warning(f"Page/context closed during goto ({goto_err}), relaunching browser and retrying...")
                await self.close()
                page = await self.ensure_page(
                    run_mode=run_mode,
                    browser_channel=browser_channel,
                    use_persistent_profile=use_persistent_profile,
                    new_tab=False,
                )
                await page.goto(clean_url, wait_until=valid_wait, timeout=timeout_ms)
            else:
                raise

        if (run_mode or "headed").strip().lower() == "headed":
            try:
                await page.bring_to_front()
            except Exception:
                pass

        # SPA 초기 렌더링 안정화를 위한 짧은 대기
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=3000)
        except Exception:
            pass

        title = await page.title()
        return {
            "url": page.url,
            "title": title,
            "run_mode": run_mode,
            "channel": self._current_config.get("browser_channel", browser_channel),
        }

    def _build_frame_candidates(self, frame: Any, selector_type: str, selector: str) -> List[Any]:
        """단일 Frame(메인 프레임 또는 중첩 iframe)에서 탐색할 Locator 후보 리스트를 생성합니다."""
        sel = (selector or "").strip()
        stype = (selector_type or "auto").strip().lower()
        candidates: List[Any] = []

        # 1. 에이전트 스냅샷 참조 ID (예: "e12", "[ref=e12]", "ref=e12")
        ref_match = re.match(r"^(?:\[?ref=)?(e\d+)\]?$", sel, re.IGNORECASE)
        if ref_match:
            ref_id = ref_match.group(1).lower()
            candidates.append(frame.locator(f'[data-pm-ref="{ref_id}"]'))
            return candidates

        if stype == "css":
            candidates.append(frame.locator(sel))
            return candidates

        if stype == "xpath":
            xpath_expr = sel if sel.startswith("xpath=") else f"xpath={sel}"
            candidates.append(frame.locator(xpath_expr))
            return candidates

        if stype == "role":
            if ":" in sel:
                role_name, acc_name = sel.split(":", 1)
                candidates.append(frame.get_by_role(role_name.strip(), name=acc_name.strip()))
            else:
                candidates.append(frame.get_by_role(sel))
            return candidates

        if stype == "placeholder":
            candidates.append(frame.get_by_placeholder(sel))
            candidates.append(frame.get_by_label(sel))
            return candidates

        if stype == "text":
            candidates.append(frame.get_by_role("button", name=sel))
            candidates.append(frame.get_by_role("link", name=sel))
            candidates.append(frame.get_by_role("tab", name=sel))
            candidates.append(frame.get_by_text(sel, exact=True))
            candidates.append(frame.get_by_text(sel, exact=False))
            candidates.append(frame.get_by_placeholder(sel))
            candidates.append(frame.get_by_label(sel))
            return candidates

        # stype == "auto" (스마트 자동 판별: XPath / CSS / 텍스트 / Placeholder 순차 탐색)
        if sel.startswith("//") or sel.startswith("(//") or sel.startswith("xpath="):
            xpath_expr = sel if sel.startswith("xpath=") else f"xpath={sel}"
            candidates.append(frame.locator(xpath_expr))
            return candidates

        if any(sel.startswith(p) for p in ("#", ".", "[")) or ">" in sel or ":" in sel:
            candidates.append(frame.locator(sel))

        candidates.append(frame.get_by_role("button", name=sel))
        candidates.append(frame.get_by_role("link", name=sel))
        candidates.append(frame.get_by_placeholder(sel))
        candidates.append(frame.get_by_label(sel))
        candidates.append(frame.get_by_text(sel, exact=True))
        candidates.append(frame.get_by_text(sel, exact=False))
        # 마지막으로 일반 CSS 태그/선택자로도 시도
        candidates.append(frame.locator(sel))
        return candidates

    async def resolve_locator(
        self,
        page: Any,
        selector_type: str,
        selector: str,
        iframe_auto_search: bool = True,
        timeout_sec: float = 5.0,
    ) -> Any:
        """
        메인 페이지 및 중첩된 모든 iframe(page.frames)을 순회하여
        실제 존재하는(attached/visible) 최적의 Playwright Locator를 반환합니다.
        """
        sel = (selector or "").strip()
        if not sel:
            raise ValueError("대상 웹 요소 선택자(Selector 또는 텍스트)가 비어 있습니다.")

        deadline = asyncio.get_event_loop().time() + max(0.5, float(timeout_sec))
        last_candidate = None

        while True:
            frames = list(page.frames) if iframe_auto_search else [page.main_frame]
            # 1차: 가시성(is_visible)이 확보된 요소 우선 매칭
            for frame in frames:
                try:
                    candidates = self._build_frame_candidates(frame, selector_type, sel)
                    for loc in candidates:
                        last_candidate = loc.first
                        try:
                            cnt = await loc.count()
                            if cnt > 0:
                                for idx in range(min(cnt, 5)):
                                    nth_loc = loc.nth(idx)
                                    if await nth_loc.is_visible():
                                        return nth_loc
                        except Exception:
                            continue
                except Exception:
                    continue

            # 2차: DOM에 존재(count > 0)하는 첫 번째 요소 매칭 (가려진 요소/강제 클릭 대비)
            for frame in frames:
                try:
                    candidates = self._build_frame_candidates(frame, selector_type, sel)
                    for loc in candidates:
                        try:
                            if await loc.count() > 0:
                                return loc.first
                        except Exception:
                            continue
                except Exception:
                    continue

            if asyncio.get_event_loop().time() >= deadline:
                break
            await asyncio.sleep(0.2)

        if last_candidate is not None:
            return last_candidate
        return page.locator(sel).first

    async def click_element(
        self,
        selector_type: str = "auto",
        selector: str = "",
        iframe_auto_search: bool = True,
        click_type: str = "single",
        force_click: bool = False,
        timeout_sec: float = 5.0,
    ) -> Dict[str, Any]:
        """마우스 커서를 이동하지 않고 웹 DOM 요소를 백그라운드/직접 클릭합니다."""
        page = await self.get_active_page()
        loc = await self.resolve_locator(
            page=page,
            selector_type=selector_type,
            selector=selector,
            iframe_auto_search=iframe_auto_search,
            timeout_sec=timeout_sec,
        )

        timeout_ms = max(500.0, float(timeout_sec) * 1000.0)
        try:
            await loc.scroll_into_view_if_needed(timeout=min(2000.0, timeout_ms))
        except Exception:
            pass

        ctype = (click_type or "single").strip().lower()
        if ctype == "double":
            await loc.dblclick(force=bool(force_click), timeout=timeout_ms)
        elif ctype == "right":
            await loc.click(button="right", force=bool(force_click), timeout=timeout_ms)
        else:
            await loc.click(force=bool(force_click), timeout=timeout_ms)

        # 클릭으로 인해 새 탭이 열렸는지 짧은 대기 후 확인
        await asyncio.sleep(0.15)
        active_page = await self.get_active_page()
        return {
            "clicked_selector": selector,
            "current_url": active_page.url,
            "current_title": await active_page.title(),
        }

    async def fill_element(
        self,
        selector_type: str = "auto",
        selector: str = "",
        text: str = "",
        input_method: str = "fill",
        press_enter: bool = False,
        iframe_auto_search: bool = True,
        timeout_sec: float = 5.0,
    ) -> Dict[str, Any]:
        """클립보드 오염이나 포커스 탈취 없이 웹 입력창에 텍스트를 주입합니다."""
        page = await self.get_active_page()
        loc = await self.resolve_locator(
            page=page,
            selector_type=selector_type,
            selector=selector,
            iframe_auto_search=iframe_auto_search,
            timeout_sec=timeout_sec,
        )

        timeout_ms = max(500.0, float(timeout_sec) * 1000.0)
        method = (input_method or "fill").strip().lower()
        if method == "type":
            await loc.click(timeout=timeout_ms)
            await loc.fill("", timeout=timeout_ms)
            await loc.press_sequentially(str(text), delay=30, timeout=timeout_ms)
        else:
            await loc.fill(str(text), timeout=timeout_ms)

        if press_enter:
            await loc.press("Enter", timeout=timeout_ms)
            await asyncio.sleep(0.25)

        return {
            "filled_selector": selector,
            "text_length": len(str(text)),
            "pressed_enter": bool(press_enter),
            "current_url": page.url,
        }

    async def extract_content(
        self,
        extract_target: str = "full_page",
        selector_type: str = "css",
        selector: str = "",
        extract_format: str = "markdown",
        attribute_name: str = "href",
        iframe_auto_search: bool = True,
        max_length: int = 15000,
    ) -> str:
        """
        웹페이지 본문 전체 또는 특정 요소의 텍스트/마크다운(표 포함)/HTML/속성값을 추출합니다.
        중첩 iframe이 있는 레거시 페이지에서도 모든 프레임의 본문을 빠짐없이 수집합니다.
        """
        page = await self.get_active_page()
        target_mode = (extract_target or "full_page").strip().lower()
        fmt = (extract_format or "markdown").strip().lower()

        if target_mode == "element" and (selector or "").strip():
            loc = await self.resolve_locator(
                page=page,
                selector_type=selector_type,
                selector=selector,
                iframe_auto_search=iframe_auto_search,
                timeout_sec=5.0,
            )
            if fmt == "attribute":
                val = await loc.get_attribute((attribute_name or "href").strip(), timeout=3000)
                result = val or ""
            elif fmt == "html":
                result = await loc.inner_html(timeout=3000)
            elif fmt == "markdown":
                result = await loc.evaluate(
                    """(el) => {
                        return (el.innerText || el.textContent || '').trim();
                    }"""
                )
            else:
                result = (await loc.inner_text(timeout=3000)).strip()
        else:
            # 전체 페이지 추출 (메인 프레임 + 중첩 iframe 본문 통합)
            frames = list(page.frames) if iframe_auto_search else [page.main_frame]
            collected_parts: List[str] = []
            for frame in frames:
                try:
                    if fmt == "html":
                        part = await frame.content()
                    elif fmt == "markdown":
                        part = await frame.evaluate(EXTRACT_MARKDOWN_JS, None)
                    else:
                        part = await frame.evaluate("() => (document.body ? document.body.innerText : '').trim()")
                    if part and str(part).strip():
                        collected_parts.append(str(part).strip())
                except Exception:
                    continue
            result = "\n\n".join(collected_parts)

        if max_length and max_length > 0 and len(result) > max_length:
            result = result[:max_length] + f"\n...(총 {len(result)}자 중 {max_length}자까지 표시됨)"
        return result

    async def get_interactive_snapshot(
        self,
        query: Optional[str] = None,
        limit: int = 60,
    ) -> Dict[str, Any]:
        """
        AI 에이전트가 픽셀 좌표를 추측하지 않고도 요소를 100% 정확히 클릭/입력할 수 있도록
        현재 페이지 및 모든 iframe 내부의 인터랙티브 요소에 고유 ref(e1, e2...)를 부여하고 목록을 반환합니다.
        """
        page = await self.get_active_page()
        all_items: List[Dict[str, Any]] = []
        ref_counter = 1

        for frame in page.frames:
            if len(all_items) >= limit:
                break
            try:
                res = await frame.evaluate(
                    SCAN_INTERACTIVE_ELEMENTS_JS,
                    {
                        "startRefIndex": ref_counter,
                        "query": query or "",
                        "maxLimit": max(1, limit - len(all_items)),
                    },
                )
                frame_items = res.get("items", [])
                ref_counter = res.get("nextIndex", ref_counter)
                is_iframe = frame != page.main_frame
                for item in frame_items:
                    if is_iframe:
                        item["in_iframe"] = True
                    all_items.append(item)
            except Exception:
                continue

        title = await page.title()
        return {
            "url": page.url,
            "title": title,
            "total_elements": len(all_items),
            "elements": all_items,
        }

    async def perform_action(
        self,
        action_type: str,
        target_value: str = "",
        option_value: str = "",
        timeout_sec: float = 10.0,
    ) -> Dict[str, Any]:
        """
        탭 전환/닫기, 뒤로/앞으로/새로고침, 드롭다운(<select>) 선택, 요소 대기, 다운로드 대기를 수행합니다.
        """
        page = await self.get_active_page()
        act = (action_type or "reload").strip().lower()

        if act == "go_back":
            await page.go_back(timeout=max(1000.0, timeout_sec * 1000.0))
            return {"action": act, "url": page.url, "title": await page.title()}

        elif act == "go_forward":
            await page.go_forward(timeout=max(1000.0, timeout_sec * 1000.0))
            return {"action": act, "url": page.url, "title": await page.title()}

        elif act == "reload":
            await page.reload(timeout=max(1000.0, timeout_sec * 1000.0))
            return {"action": act, "url": page.url, "title": await page.title()}

        elif act == "switch_tab":
            if not self._is_context_alive():
                raise RuntimeError("열려 있는 브라우저 세션이 없습니다.")
            pages = [p for p in self._context.pages if not p.is_closed()]
            if not pages:
                raise RuntimeError("전환할 브라우저 탭이 없습니다.")

            kw = (target_value or "").strip()
            if not kw or kw.lower() in ("latest", "last", "newest"):
                self._current_page = pages[-1]
            elif kw.lower() in ("next",):
                curr_idx = pages.index(page) if page in pages else 0
                self._current_page = pages[(curr_idx + 1) % len(pages)]
            elif kw.lower() in ("prev", "previous"):
                curr_idx = pages.index(page) if page in pages else 0
                self._current_page = pages[(curr_idx - 1) % len(pages)]
            elif kw.isdigit():
                idx = max(0, min(len(pages) - 1, int(kw) - 1))
                self._current_page = pages[idx]
            else:
                matched = None
                for p in pages:
                    t_title = await p.title()
                    if kw.lower() in (t_title or "").lower() or kw.lower() in (p.url or "").lower():
                        matched = p
                        break
                if matched is None:
                    raise ValueError(f"'{kw}' 키워드를 포함하는 브라우저 탭을 찾을 수 없습니다.")
                self._current_page = matched

            try:
                await self._current_page.bring_to_front()
            except Exception:
                pass
            return {
                "action": act,
                "url": self._current_page.url,
                "title": await self._current_page.title(),
                "tab_count": len(pages),
            }

        elif act == "close_tab":
            await page.close()
            pages = [p for p in self._context.pages if not p.is_closed()] if self._is_context_alive() else []
            self._current_page = pages[-1] if pages else None
            return {
                "action": act,
                "remaining_tabs": len(pages),
                "url": self._current_page.url if self._current_page else "",
            }

        elif act == "select_option":
            loc = await self.resolve_locator(
                page=page,
                selector_type="auto",
                selector=target_value,
                iframe_auto_search=True,
                timeout_sec=timeout_sec,
            )
            opt = (option_value or "").strip()
            try:
                selected = await loc.select_option(label=opt, timeout=3000)
            except Exception:
                selected = await loc.select_option(value=opt, timeout=3000)
            return {"action": act, "selector": target_value, "selected": selected}

        elif act == "wait_for_element":
            loc = await self.resolve_locator(
                page=page,
                selector_type="auto",
                selector=target_value,
                iframe_auto_search=True,
                timeout_sec=timeout_sec,
            )
            await loc.wait_for(state="visible", timeout=max(500.0, timeout_sec * 1000.0))
            return {"action": act, "selector": target_value, "status": "visible"}

        elif act == "wait_for_download":
            # target_value가 지정된 경우 해당 요소를 클릭하여 다운로드를 트리거하고 저장 완료까지 대기
            save_dir = Path(option_value.strip()) if (option_value or "").strip() else BROWSER_DOWNLOAD_DIR
            save_dir.mkdir(parents=True, exist_ok=True)
            async with page.expect_download(timeout=max(1000.0, timeout_sec * 1000.0)) as download_info:
                if (target_value or "").strip():
                    loc = await self.resolve_locator(
                        page=page,
                        selector_type="auto",
                        selector=target_value,
                        iframe_auto_search=True,
                        timeout_sec=min(5.0, timeout_sec),
                    )
                    await loc.click()
            download = await download_info.value
            dest_path = save_dir / download.suggested_filename
            await download.save_as(str(dest_path))
            self._last_downloaded_file = str(dest_path)
            return {
                "action": act,
                "file_path": str(dest_path),
                "filename": download.suggested_filename,
            }

        raise ValueError(f"지원하지 않는 브라우저 제어 액션입니다: '{action_type}'")

    async def get_page_info(self, info_type: str = "url") -> Any:
        """현재 활성 웹페이지의 URL, 제목, 또는 전체 탭 목록 정보를 반환합니다."""
        page = await self.get_active_page()
        itype = (info_type or "url").strip().lower()
        title = await page.title()

        if itype == "url":
            return page.url
        elif itype == "title":
            return title
        elif itype == "tabs_json":
            pages = [p for p in self._context.pages if not p.is_closed()] if self._is_context_alive() else [page]
            tabs = []
            for idx, p in enumerate(pages):
                tabs.append({
                    "index": idx + 1,
                    "title": await p.title(),
                    "url": p.url,
                    "active": p == page,
                })
            return tabs
        else:
            return {"url": page.url, "title": title}

    async def evaluate_js(self, script: str) -> Any:
        """
        현재 활성 웹페이지에서 사용자 정의 JavaScript를 실행하고 결과를 반환합니다.
        레거시 독자 UI 프레임워크(WebSquare, Nexacro, Canvas 등) API 직접 호출을 지원합니다.
        """
        page = await self.get_active_page()
        clean_script = (script or "").strip()
        if not clean_script:
            raise ValueError("실행할 JavaScript 코드가 비어 있습니다.")

        # 사용자가 'return ...' 형태로 작성했거나 함수 표현식이 아닌 경우 자동 래핑
        if not clean_script.startswith("(") and not clean_script.startswith("function") and not clean_script.startswith("async"):
            if "return " in clean_script or ";" in clean_script or "\n" in clean_script:
                wrapped = f"() => {{ {clean_script} }}"
            else:
                wrapped = f"() => ({clean_script})"
        else:
            wrapped = clean_script

        return await page.evaluate(wrapped)

    # ==================== 비주얼 웹 요소 선택기 (Web Picker) ====================

    async def _cleanup_all_picker_overlays(self) -> None:
        """모든 열린 탭 및 중첩 iframe에서 Web Picker 하이라이트 오버레이와 리스너를 제거합니다."""
        if not self._is_context_alive() or self._context is None:
            return
        try:
            pages = [p for p in self._context.pages if not p.is_closed()]
            for p in pages:
                for frame in p.frames:
                    try:
                        await frame.evaluate(CLEANUP_WEB_PICKER_JS)
                    except Exception:
                        pass
        except Exception:
            pass

    async def start_web_picker(
        self,
        url: Optional[str] = None,
        browser_channel: str = "chrome",
        use_persistent_profile: bool = True,
    ) -> Dict[str, Any]:
        """
        Playwright 브라우저 창을 전면(headed)으로 띄우고 모든 프레임(iframe 포함)에
        비주얼 웹 요소 선택기(Web Picker) 오버레이를 주입한 뒤 백그라운드 감지 루프를 시작합니다.
        """
        await self.cancel_web_picker()

        page = await self.ensure_page(
            run_mode="headed",
            browser_channel=browser_channel,
            use_persistent_profile=use_persistent_profile,
            new_tab=False,
        )

        current_url = (page.url or "").strip()
        is_blank = (
            not current_url
            or current_url == "about:blank"
            or current_url.startswith("chrome://newtab")
            or current_url.startswith("edge://newtab")
        )

        clean_target_url = (url or "").strip()
        if clean_target_url and is_blank:
            if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", clean_target_url) and not clean_target_url.startswith("about:"):
                clean_target_url = "https://" + clean_target_url
            try:
                await page.goto(clean_target_url, wait_until="domcontentloaded", timeout=15000)
            except Exception as nav_err:
                logger.warning(f"Web picker initial URL navigation warning ({clean_target_url}): {nav_err}")

        try:
            await page.bring_to_front()
        except Exception:
            pass

        self._picker_active = True
        self._picker_status = "picking"
        self._picker_result = None
        self._picker_error = None

        # 즉시 1차 주입
        for frame in page.frames:
            try:
                await frame.evaluate(CLEANUP_WEB_PICKER_JS)
                await frame.evaluate(WEB_PICKER_INJECT_JS, "pick")
            except Exception:
                pass

        self._picker_task = asyncio.create_task(self._web_picker_loop())
        title = ""
        try:
            title = await page.title()
        except Exception:
            pass

        return {
            "active": True,
            "status": "picking",
            "url": page.url,
            "title": title,
        }

    async def _web_picker_loop(self) -> None:
        """
        150ms 주기로 열린 모든 탭과 중첩 iframe을 순회하며:
        1) 페이지 이동이나 동적 iframe 로드 시 선택기 오버레이를 자동 재주입
        2) 메인 프레임의 모드('pick' vs 'navigate')를 하위 iframe들과 동기화
        3) 사용자의 요소 클릭(picked) 또는 취소(cancelled) 결과를 수집
        """
        try:
            while self._picker_active:
                if not self._is_context_alive() or self._context is None:
                    self._picker_active = False
                    self._picker_status = "cancelled"
                    break

                pages = [p for p in self._context.pages if not p.is_closed()]
                if not pages:
                    self._picker_active = False
                    self._picker_status = "cancelled"
                    break

                for p in pages:
                    try:
                        top_mode = "pick"
                        try:
                            mode_val = await p.main_frame.evaluate("() => window.__pm_picker_mode || 'pick'")
                            if mode_val in ("pick", "navigate"):
                                top_mode = mode_val
                        except Exception:
                            pass

                        for frame in p.frames:
                            try:
                                res = await frame.evaluate("() => window.__pm_picker_result || null")
                                if isinstance(res, dict):
                                    st = res.get("status")
                                    if st == "picked":
                                        elem = dict(res.get("element") or {})
                                        elem["page_url"] = p.url
                                        try:
                                            elem["page_title"] = await p.title()
                                        except Exception:
                                            elem["page_title"] = ""
                                        elem["in_iframe"] = frame != p.main_frame
                                        self._picker_result = elem
                                        self._picker_status = "picked"
                                        self._picker_active = False
                                        await self._cleanup_all_picker_overlays()
                                        return
                                    elif st == "cancelled":
                                        self._picker_status = "cancelled"
                                        self._picker_active = False
                                        await self._cleanup_all_picker_overlays()
                                        return

                                await frame.evaluate(WEB_PICKER_INJECT_JS, top_mode)
                            except Exception:
                                pass
                    except Exception:
                        pass

                await asyncio.sleep(0.15)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"Web picker loop error: {e}")
            self._picker_error = str(e)
            self._picker_status = "error"
            self._picker_active = False

    def get_web_picker_status(self) -> Dict[str, Any]:
        """현재 Web Picker의 진행 상태 및 선택된 웹 요소 메타데이터를 반환합니다."""
        return {
            "active": self._picker_active,
            "status": self._picker_status,
            "element": self._picker_result,
            "error": self._picker_error,
        }

    async def cancel_web_picker(self) -> Dict[str, Any]:
        """진행 중인 Web Picker 세션을 중단하고 브라우저 내 오버레이를 즉시 정리합니다."""
        self._picker_active = False
        if self._picker_task is not None and not self._picker_task.done():
            self._picker_task.cancel()
            try:
                await self._picker_task
            except Exception:
                pass
        self._picker_task = None
        await self._cleanup_all_picker_overlays()
        if self._picker_status == "picking":
            self._picker_status = "cancelled"
        return {
            "active": False,
            "status": self._picker_status,
        }


playwright_service = PlaywrightService()
