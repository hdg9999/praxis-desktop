import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import {
  MousePointer,
  Move,
  Hand,
  ArrowUpDown,
  Type,
  Command,
  Clock,
  Copy,
  ClipboardPaste,
  FileText,
  Save,
  MessageSquare,
  X,
  AppWindow,
  Maximize2,
  Minimize2,
  Camera,
  Rocket,
  XCircle,
  Power,
  Ban,
  Globe,
  MousePointerClick,
  FormInput,
  FileSearch,
  Compass,
  Info,
  Code2,
} from 'lucide-react';
import { FlowNodeData } from '../../types';
import { useI18n } from '../../i18n';

const GeneralNode: React.FC<NodeProps> = ({ id, data, type, selected }) => {
  const { deleteElements } = useReactFlow();
  const { t } = useI18n();
  const nodeData = (data || {}) as unknown as FlowNodeData;
  const resolvedType = nodeData.type || (type as string) || 'general_delay';
  const isBrowserNode = String(resolvedType).startsWith('browser_');
  const subtype = isBrowserNode ? String(resolvedType) : String(resolvedType).replace('general_', '');

  const handleDelete = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (typeof (data as any)?.onDelete === 'function') {
      (data as any).onDelete(id);
    } else {
      deleteElements({ nodes: [{ id }] });
    }
  };

  const getIcon = () => {
    switch (subtype) {
      case 'mouse_click': return <MousePointer className="w-4 h-4 text-blue-400" />;
      case 'mouse_move': return <Move className="w-4 h-4 text-cyan-400" />;
      case 'mouse_drag': return <Hand className="w-4 h-4 text-indigo-400" />;
      case 'mouse_scroll': return <ArrowUpDown className="w-4 h-4 text-sky-400" />;
      case 'keyboard_type': return <Type className="w-4 h-4 text-emerald-400" />;
      case 'keyboard_hotkey': return <Command className="w-4 h-4 text-indigo-400" />;
      case 'delay': return <Clock className="w-4 h-4 text-amber-400" />;
      case 'clipboard_copy': return <Copy className="w-4 h-4 text-purple-400" />;
      case 'clipboard_read': return <ClipboardPaste className="w-4 h-4 text-violet-400" />;
      case 'file_read': return <FileText className="w-4 h-4 text-emerald-400" />;
      case 'file_write': return <Save className="w-4 h-4 text-teal-400" />;
      case 'message_box': return <MessageSquare className="w-4 h-4 text-amber-400" />;
      case 'window_activate': return <AppWindow className="w-4 h-4 text-sky-400" />;
      case 'window_maximize': return <Maximize2 className="w-4 h-4 text-cyan-400" />;
      case 'window_minimize': return <Minimize2 className="w-4 h-4 text-slate-400" />;
      case 'window_close': return <XCircle className="w-4 h-4 text-rose-400" />;
      case 'screenshot': return <Camera className="w-4 h-4 text-teal-400" />;
      case 'launch_program': return <Rocket className="w-4 h-4 text-orange-400" />;
      case 'close_program': return <Power className="w-4 h-4 text-amber-400" />;
      case 'kill_process': return <Ban className="w-4 h-4 text-rose-500" />;
      case 'browser_navigate': return <Globe className="w-4 h-4 text-cyan-400" />;
      case 'browser_click': return <MousePointerClick className="w-4 h-4 text-sky-400" />;
      case 'browser_fill': return <FormInput className="w-4 h-4 text-emerald-400" />;
      case 'browser_extract': return <FileSearch className="w-4 h-4 text-teal-400" />;
      case 'browser_action': return <Compass className="w-4 h-4 text-indigo-400" />;
      case 'browser_get_info': return <Info className="w-4 h-4 text-blue-400" />;
      case 'browser_evaluate': return <Code2 className="w-4 h-4 text-amber-400" />;
      default: return <MousePointer className="w-4 h-4 text-slate-400" />;
    }
  };

  const getSummary = () => {
    const cfg = nodeData.config || {};
    if (subtype === 'mouse_click') {
      const moveLabel = cfg.move_mode === 'smooth' ? ` · ⌛${cfg.duration ?? 0.2}s` : '';
      if (cfg.click_mode === 'object' || cfg.object_data) {
        const objName = cfg.object_data?.name || (t('inspector.mouseClick.modeObject'));
        const modeLabel = cfg.search_mode === 'uia_only'
          ? t('nodes.uiaOnlyMode')
          : cfg.search_mode === 'image_only'
          ? t('nodes.imageOnlyMode')
          : t('nodes.hybridMode');
        return `🎯 [${modeLabel}] ${objName} (${cfg.button ?? 'left'}${moveLabel})`;
      }
      const coordStr = `(${cfg.x ?? 'X'}, ${cfg.y ?? 'Y'})`;
      return `${coordStr} ${cfg.button ?? 'left'}${moveLabel}`;
    }
    if (subtype === 'mouse_move') {
      return `(${cfg.x ?? 0}, ${cfg.y ?? 0}) · ⌛${cfg.duration ?? 0.2}s`;
    }
    if (subtype === 'mouse_drag') {
      const sMode = cfg.start_mode === 'object' ? `🎯${cfg.start_object_data?.name || '오브젝트'}` : `(${cfg.start_x ?? 0},${cfg.start_y ?? 0})`;
      const eMode = cfg.end_mode === 'object' ? `🎯${cfg.end_object_data?.name || '오브젝트'}` : `(${cfg.end_x ?? 0},${cfg.end_y ?? 0})`;
      const mLabel = cfg.move_mode === 'instant' ? '즉시' : `${cfg.duration ?? 0.5}s`;
      return `✋ ${sMode} → ${eMode} (${mLabel})`;
    }
    if (subtype === 'mouse_scroll') {
      const dirLabel = cfg.direction === 'horizontal' ? '좌우' : '상하';
      const targetLabel = cfg.target_mode === 'current'
        ? '활성창'
        : `🎯${cfg.object_data?.name || '오브젝트'}`;
      const distMap: Record<string, string> = {
        ticks: `휠 ${cfg.ticks ?? 5}칸(${cfg.ticks_direction === 'forward' ? (cfg.direction === 'horizontal' ? '좌' : '위') : (cfg.direction === 'horizontal' ? '우' : '아래')})`,
        page_down: '1페이지 뒤로',
        page_up: '1페이지 앞으로',
        end: '맨끝으로',
        home: '맨처음으로',
      };
      const distLabel = cfg.target_mode === 'current'
        ? distMap.ticks
        : (distMap[cfg.distance_mode || 'ticks'] || distMap.ticks);
      return `↕️ [${dirLabel}·${targetLabel}] ${distLabel}`;
    }
    if (subtype === 'keyboard_type') {
      const typeLabel = cfg.type_mode === 'smooth' ? ` · ⌨️${cfg.interval ?? 0.05}s` : '';
      return `"${(cfg.text || '').slice(0, 15)}${(cfg.text || '').length > 15 ? '...' : ''}"${typeLabel}`;
    }
    if (subtype === 'keyboard_hotkey') return `${cfg.keys || 'hotkey'}`;
    if (subtype === 'delay') {
      if (cfg.dynamic_wait) {
        const targetName = cfg.object_data?.name || cfg.object_data?.window_title || 'Object';
        const modeName = cfg.wait_mode === 'window_ready' ? t('nodes.dynamicWaitWindow') : t('nodes.dynamicWaitElement');
        const timeoutStr = `(${t('nodes.timeoutSec', { sec: cfg.seconds ?? 5 })})`;
        return `⚡ [${modeName}] ${targetName} ${timeoutStr}`;
      }
      return t('nodes.fixedDelay', { sec: cfg.seconds ?? 1 });
    }
    if (subtype === 'clipboard_copy') return `${t('common.copy')}: "${(cfg.text || '').slice(0, 15)}"`;
    if (subtype === 'clipboard_read') return `📋 → {{${cfg.output_variable || 'clipboard_text'}}}`;
    if (subtype === 'file_read') {
      const fname = (cfg.file_path || '').split(/[\\/]/).pop() || '파일 미지정';
      return `📄 ${fname} → {{${cfg.output_variable || 'file_content'}}}`;
    }
    if (subtype === 'file_write') {
      const fname = (cfg.file_path || '').split(/[\\/]/).pop() || '파일 미지정';
      const ovLabel = cfg.overwrite ? '덮어쓰기' : '보호';
      return `💾 ${fname} [${ovLabel}]`;
    }
    if (subtype === 'message_box') {
      const btnMap: Record<string, string> = { ok: '확인', yes_no: '예/아니오', continue_stop: '계속/중지' };
      const typeIconMap: Record<string, string> = { info: 'ℹ️', warning: '⚠️', error: '🚨' };
      return `${typeIconMap[cfg.message_type || 'info'] || '💬'} [${btnMap[cfg.button_type || 'ok'] || '확인'}] "${(cfg.title || '알림').slice(0, 12)}"`;
    }
    if (subtype === 'window_activate') {
      if (cfg.target_mode === 'object' && cfg.object_data) {
        return `🎯 [${t('skills.general_window_activate.label')}] ${cfg.object_data.name || cfg.object_data.window_title || 'Object'}`;
      }
      if (cfg.target_mode === 'title') {
        return `🪟 [${t('skills.general_window_activate.label')}] "${cfg.window_title || 'Window'}"`;
      }
      return `🪟 [${t('skills.general_window_activate.label')}]`;
    }
    if (subtype === 'window_maximize') {
      if (cfg.target_mode === 'object' && cfg.object_data) {
        return `🎯 [${t('skills.general_window_maximize.label')}] ${cfg.object_data.name || cfg.object_data.window_title || 'Object'}`;
      }
      if (cfg.target_mode === 'title') {
        return `🪟 [${t('skills.general_window_maximize.label')}] "${cfg.window_title || 'Window'}"`;
      }
      if (cfg.target_mode === 'current') return `🪟 [${t('inspector.window.modeCurrent')}]`;
      return `🪟 [${t('skills.general_window_maximize.label')}]`;
    }
    if (subtype === 'window_minimize') {
      if (cfg.target_mode === 'object' && cfg.object_data) {
        return `🎯 [${t('skills.general_window_minimize.label')}] ${cfg.object_data.name || cfg.object_data.window_title || 'Object'}`;
      }
      if (cfg.target_mode === 'title') {
        return `🪟 [${t('skills.general_window_minimize.label')}] "${cfg.window_title || 'Window'}"`;
      }
      if (cfg.target_mode === 'current') return `🪟 [${t('inspector.window.modeCurrent')}]`;
      return `🪟 [${t('skills.general_window_minimize.label')}]`;
    }
    if (subtype === 'window_close') {
      if (cfg.target_mode === 'object' && cfg.object_data) {
        return `🎯 [${t('skills.general_window_close.label')}] ${cfg.object_data.name || cfg.object_data.window_title || 'Object'}`;
      }
      if (cfg.target_mode === 'title') {
        return `🪟 [${t('skills.general_window_close.label')}] "${cfg.window_title || 'Window'}"`;
      }
      if (cfg.target_mode === 'current') return `⚡ [${t('inspector.window.modeCurrent')}]`;
      return `🪟 [${t('skills.general_window_close.label')}]`;
    }
    if (subtype === 'screenshot') {
      const targetLabel = cfg.capture_target === 'all' ? t('nodes.screenshotAll') : t('nodes.screenshotMain');
      const saveFile = cfg.save_to_file ?? true;
      const copyCb = cfg.copy_to_clipboard ?? false;
      const methodLabel = (saveFile && copyCb)
        ? `${t('nodes.saveFile')}+${t('nodes.copyClipboard')}`
        : saveFile
        ? t('nodes.saveFile')
        : copyCb
        ? t('nodes.copyClipboard')
        : t('common.none');
      return `📷 [${targetLabel}] ${methodLabel}`;
    }
    if (subtype === 'launch_program') {
      const progPath = cfg.program_path || '';
      const filename = progPath ? progPath.split(/[\\/]/).pop() || progPath : t('common.none');
      const argsLabel = cfg.arguments ? ` (${cfg.arguments.slice(0, 15)}${cfg.arguments.length > 15 ? '...' : ''})` : '';
      return `🚀 ${filename}${argsLabel}`;
    }
    if (subtype === 'close_program') {
      return `⏹️ ${t('skills.general_close_program.label')}: "${cfg.process_name || t('common.none')}"`;
    }
    if (subtype === 'kill_process') {
      return `☠️ ${t('skills.general_kill_process.label')}: "${cfg.process_name || t('common.none')}"`;
    }
    if (subtype === 'browser_navigate') {
      const modeTag = cfg.run_mode === 'headless' ? '👻Headless' : cfg.run_mode === 'minimized' ? '🔽최소화' : '🌐창';
      return `[${modeTag}] ${(cfg.url || '').slice(0, 24)}`;
    }
    if (subtype === 'browser_click') {
      const targetName = cfg.web_element_data?.display_name || cfg.selector || '';
      const iframeTag = cfg.web_element_data?.in_iframe ? '[iframe] ' : '';
      return `🎯 ${iframeTag}[${cfg.selector_type || 'auto'}] "${String(targetName).slice(0, 18)}"`;
    }
    if (subtype === 'browser_fill') {
      const enterBadge = cfg.press_enter ? ' ↵' : '';
      const targetName = cfg.web_element_data?.display_name || cfg.selector || '';
      return `⌨️ "${String(targetName).slice(0, 10)}" ➔ "${(cfg.text || '').slice(0, 12)}"${enterBadge}`;
    }
    if (subtype === 'browser_extract') {
      const scopeTag =
        cfg.extract_target === 'element'
          ? cfg.web_element_data?.display_name
            ? `🎯${String(cfg.web_element_data.display_name).slice(0, 8)}`
            : '요소'
          : '전체본문';
      return `📑 [${scopeTag}·${cfg.extract_format || 'md'}] → {{${cfg.output_variable || 'web_content'}}}`;
    }
    if (subtype === 'browser_action') {
      return `🧭 [${cfg.action_type || 'switch_tab'}] ${(cfg.target_value || '').slice(0, 16)}`;
    }
    if (subtype === 'browser_get_info') {
      return `ℹ️ [${cfg.info_type || 'url'}] → {{${cfg.output_variable || 'web_info'}}}`;
    }
    if (subtype === 'browser_evaluate') {
      return `⚡ JS → {{${cfg.output_variable || 'js_result'}}}`;
    }
    return subtype;
  };

  return (
    <div
      className={`relative min-w-[190px] rounded-xl bg-slate-900 border transition-all shadow-md px-3 py-2.5 ${
        selected ? 'border-blue-500 shadow-blue-500/20 ring-1 ring-blue-500' : 'border-slate-700/80 hover:border-slate-600'
      }`}
    >
      {/* 노드 선택 시 우상단 동그란 ✕ 삭제 버튼 */}
      {selected && (
        <button
          onClick={handleDelete}
          className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow-lg border border-slate-900 transition-all hover:scale-110 cursor-pointer z-30"
          title={t('nodes.deleteNode')}
          type="button"
        >
          <X className="w-3 h-3 stroke-[2.5]" />
        </button>
      )}

      {/* Left Input Handle (target) */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3.5 !h-3.5 !bg-blue-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-blue-400 cursor-crosshair"
      />

      <div className="flex items-center gap-2 mb-1.5">
        <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60">
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-200 truncate">{nodeData.label}</div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <span>{subtype}</span>
            {isBrowserNode && (
              <span className="px-1 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 text-[9px] font-semibold normal-case">
                Playwright
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 bg-slate-950/60 rounded px-2 py-1 border border-slate-800/80 truncate">
        {getSummary()}
      </div>

      {/* Right Output Handle (source) */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3.5 !h-3.5 !bg-blue-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-blue-400 cursor-crosshair"
      />
    </div>
  );
};

export default memo(GeneralNode);
