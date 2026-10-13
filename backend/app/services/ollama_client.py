import json
from typing import AsyncGenerator, List, Dict, Any, Optional
import httpx
from app.core.config import settings

class OllamaClient:
    def __init__(self, base_url: str = settings.OLLAMA_BASE_URL):
        self.base_url = base_url.rstrip("/")

    async def check_health(self) -> bool:
        """Ollama 서버 구동 여부 확인"""
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                return res.status_code == 200
        except Exception:
            return False

    async def get_models(self) -> List[str]:
        """로컬에 다운로드된 Ollama 모델 이름 목록 반환"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("name", "") for m in data.get("models", [])]
                    return [m for m in models if m]
        except Exception:
            pass
        return []

    # 하위 호환성 별칭
    get_installed_models = get_models

    async def stream_generate(
        self,
        model: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7
    ) -> AsyncGenerator[str, None]:
        """
        Ollama 스트리밍 응답 제너레이터.
        토큰 조각(str)을 실시간으로 yield함.
        """
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": temperature
            }
        }
        if system_prompt:
            payload["system"] = system_prompt

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                async with client.stream("POST", f"{self.base_url}/api/generate", json=payload) as response:
                    if response.status_code != 200:
                        err_text = ""
                        try:
                            err_body = await response.aread()
                            err_json = json.loads(err_body)
                            err_text = err_json.get("error", err_body.decode(errors="ignore"))
                        except Exception:
                            pass
                        if response.status_code == 404:
                            yield f"[Ollama 오류 (404 Not Found): 모델 '{model}'을(를) 찾을 수 없습니다. Ollama에 해당 모델이 다운로드되어 있는지 확인해 주세요.]"
                        else:
                            yield f"[Ollama 오류 ({response.status_code}): {err_text or '요청 실패'}]"
                        return

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                            token = chunk.get("response", "")
                            if token:
                                yield token
                            if chunk.get("done", False):
                                break
                        except json.JSONDecodeError:
                            continue
            except httpx.ConnectError:
                yield "[오류: Ollama 서버(localhost:11434)에 연결할 수 없습니다. Ollama가 켜져 있는지 확인해 주세요.]"
            except Exception as e:
                yield f"[오류 발생: {str(e)}]"

    async def chat(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.3,
        stream: bool = False
    ) -> Dict[str, Any]:
        """
        Ollama /api/chat 비스트리밍 호출.
        Tool Calling 응답을 포함한 assistant 메시지 dict 반환:
        {'role': 'assistant', 'content': '...', 'tool_calls': [...]}
        """
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                res = await client.post(f"{self.base_url}/api/chat", json=payload)
                if res.status_code == 200:
                    data = res.json()
                    return data.get("message", {"role": "assistant", "content": ""})
                else:
                    err_msg = ""
                    try:
                        err_json = res.json()
                        err_msg = err_json.get("error", res.text)
                    except Exception:
                        err_msg = res.text
                    if res.status_code == 404:
                        return {
                            "role": "assistant",
                            "content": f"[Ollama 오류 (404 Not Found): 모델 '{model}'을(를) 찾을 수 없습니다. Ollama에 해당 모델이 다운로드되어 있는지 확인해 주세요.]",
                            "tool_calls": []
                        }
                    return {
                        "role": "assistant",
                        "content": f"[Ollama 오류 ({res.status_code}): {err_msg}]",
                        "tool_calls": []
                    }
            except httpx.ConnectError:
                return {
                    "role": "assistant",
                    "content": "[오류: Ollama 서버(localhost:11434)에 연결할 수 없습니다.]",
                    "tool_calls": []
                }
            except Exception as e:
                return {
                    "role": "assistant",
                    "content": f"[오류 발생: {str(e)}]",
                    "tool_calls": []
                }

    async def stream_chat(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.3
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Ollama /api/chat 스트리밍 제너레이터.
        각 chunk event를 yield함:
        - {"type": "content", "token": "..."}
        - {"type": "thinking", "token": "..."}
        - {"type": "done", "message": {...}}
        """
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": temperature
            }
        }
        if tools:
            payload["tools"] = tools

        accumulated_content = ""
        accumulated_tool_calls: List[Dict[str, Any]] = []
        is_thinking = False

        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                    if response.status_code != 200:
                        err_text = ""
                        try:
                            err_body = await response.aread()
                            err_json = json.loads(err_body)
                            err_text = err_json.get("error", err_body.decode(errors="ignore"))
                        except Exception:
                            pass
                        if response.status_code == 404:
                            msg = f"[Ollama 오류 (404 Not Found): 모델 '{model}'을(를) 찾을 수 없습니다. Ollama에 해당 모델이 다운로드되어 있는지 확인해 주세요.]"
                        else:
                            msg = f"[Ollama 오류 ({response.status_code}): {err_text or '요청 실패'}]"
                        yield {
                            "type": "content",
                            "token": msg
                        }
                        return

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                            msg = chunk.get("message", {})
                            token = msg.get("content", "")

                            # tool_calls 축적
                            if msg.get("tool_calls"):
                                for tc in msg["tool_calls"]:
                                    accumulated_tool_calls.append(tc)

                            if token:
                                accumulated_content += token

                                # <think> 태그 감지 및 분기
                                if "<think>" in token:
                                    is_thinking = True
                                    yield {"type": "thinking", "token": token.replace("<think>", "")}
                                elif "</think>" in token:
                                    is_thinking = False
                                    yield {"type": "thinking", "token": token.replace("</think>", "")}
                                elif is_thinking:
                                    yield {"type": "thinking", "token": token}
                                else:
                                    yield {"type": "content", "token": token}

                            if chunk.get("done", False):
                                final_msg = chunk.get("message", {})
                                if not final_msg.get("content"):
                                    final_msg["content"] = accumulated_content
                                if accumulated_tool_calls and not final_msg.get("tool_calls"):
                                    final_msg["tool_calls"] = accumulated_tool_calls
                                yield {
                                    "type": "done",
                                    "message": final_msg
                                }
                                break
                        except json.JSONDecodeError:
                            continue
            except httpx.ConnectError:
                yield {
                    "type": "content",
                    "token": "[오류: Ollama 서버(localhost:11434)에 연결할 수 없습니다.]"
                }
            except Exception as e:
                yield {
                    "type": "content",
                    "token": f"[오류 발생: {str(e)}]"
                }

ollama_client = OllamaClient()
