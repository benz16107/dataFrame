import os
import ast
import json
import re
import base64
import uuid as uuid_lib
from typing import Annotated, Any

from auth0_fastapi.auth.auth_client import AuthClient
from auth0_fastapi.config import Auth0Config
from auth0_fastapi.server.routes import register_auth_routes, router
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field as PydanticField
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlmodel import Field, Relationship, Session, SQLModel, create_engine, select
from datetime import datetime, timezone
from sqlalchemy import Column, JSON, text
from starlette.middleware.sessions import SessionMiddleware

# 1. NEW IMPORT FOR GEMINI
try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None

load_dotenv()

# 2. INITIALIZE GEMINI CLIENT
# Make sure GEMINI_API_KEY is in your .env file
gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
client = genai.Client(api_key=gemini_api_key) if genai and gemini_api_key else None

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_SYSTEM_PROMPT = os.getenv(
    "GEMINI_SYSTEM_PROMPT",
    (
        "You are a deterministic data transformation tool used inside a workflow node. "
        "Do not provide advice, explanations, suggestions, warnings, or conversational text. "
        "Only return the requested transformed/generated result as a Python-object-compatible value. "
        "Valid outputs: string, int, float, bool, null/None, list, or dict. "
        "Prefer strict JSON-compatible syntax when possible so it can be parsed reliably. "
        "If multiple outputs are needed, return a dict with keys output, output2, output3, etc. "
        "If a single output is needed, return only that single value. "
        "For plot requests (single-input Plot node), return one structured payload value only: "
        "line/scatter payload: {\"x\": [...], \"y\": [...]} or [{\"x\": number, \"y\": number}, ...] or {\"x\": number, \"y\": number}; "
        "bar payload: {\"labels\": [...], \"values\": [...]} or [{\"label\": string, \"value\": number}, ...] or {\"label\": string, \"value\": number}. "
        "Return only data, no markdown, no code fences, no surrounding prose."
    ),
)

class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    email: str = Field(index=True, unique=True)

class CanvasCreate(BaseModel):
    name: str

class Canvas(SQLModel, table=True):
    id: str = Field(
        default_factory=lambda: str(uuid_lib.uuid4()),
        primary_key=True,
        unique=True,
    )
    name: str
    owner_sub: str = Field(index=True)
    shapes: list["Shape"] = Relationship(back_populates="canvas")

class TLShape(BaseModel):
    id: str
    type: str

    model_config = ConfigDict(extra="allow")

class Shape(SQLModel, table=True):
    id: str = Field(primary_key=True)

    canvas_id: str = Field(foreign_key="canvas.id", index=True)

    document_id: str | None = Field(default=None, index=True)
    type: str = Field(index=True)

    data: dict = Field(
        sa_column=Column(JSON, nullable=False)
    )

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    canvas: Canvas = Relationship(back_populates="shapes")

# 3. CHAT REQUEST MODEL
class ChatInputItem(BaseModel):
    type: str
    name: str | None = None
    mimeType: str | None = None
    dataBase64: str | None = None
    value: Any | None = None


class ChatRequest(BaseModel):
    message: str | None = None
    prompt: str | None = None
    inputs: list[ChatInputItem] = PydanticField(default_factory=list)


GEMINI_ALLOWED_MIME_PREFIXES = (
    "image/",
    "text/",
)
GEMINI_ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/json",
}
GEMINI_MAX_INLINE_BYTES = int(os.getenv("GEMINI_MAX_INLINE_BYTES", str(8 * 1024 * 1024)))


def _stringify_input_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value)
    except Exception:
        return str(value)


def _build_gemini_contents(request: ChatRequest) -> str | list[Any]:
    prompt_text = (request.prompt or request.message or "").strip()
    if not prompt_text:
        raise HTTPException(status_code=400, detail="Missing prompt/message")

    if not request.inputs:
        return prompt_text

    has_media_inputs = any((item.type or "").strip().lower() in {"image", "file"} for item in request.inputs)
    if has_media_inputs and genai_types is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Gemini file/image input is not available with current SDK. "
                "Upgrade google-genai to a version that supports google.genai.types."
            ),
        )

    sdk_parts: list[Any] = []
    raw_parts: list[dict[str, Any]] = [{"text": prompt_text}]

    if genai_types is not None:
        sdk_parts.append(genai_types.Part.from_text(text=prompt_text))

    has_multimodal_part = False
    sdk_has_multimodal_part = False

    for item in request.inputs:
        item_type = (item.type or "").strip().lower()

        if item_type in {"image", "file"}:
            if not item.mimeType or not item.dataBase64:
                continue

            mime_type = item.mimeType.strip().lower()
            if not (
                mime_type in GEMINI_ALLOWED_MIME_TYPES
                or any(mime_type.startswith(prefix) for prefix in GEMINI_ALLOWED_MIME_PREFIXES)
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type for Gemini: {item.mimeType}",
                )

            raw_parts.append(
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": item.dataBase64,
                    }
                }
            )

            if genai_types is not None:
                try:
                    decoded = base64.b64decode(item.dataBase64, validate=True)
                    if len(decoded) > GEMINI_MAX_INLINE_BYTES:
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"File too large for Gemini inline upload: {len(decoded)} bytes "
                                f"(max {GEMINI_MAX_INLINE_BYTES} bytes)."
                            ),
                        )
                    sdk_parts.append(
                        genai_types.Part.from_bytes(data=decoded, mime_type=mime_type)
                    )
                    sdk_has_multimodal_part = True
                except HTTPException:
                    raise
                except Exception:
                    raise HTTPException(status_code=400, detail=f"Invalid base64 payload for {item.name or 'file'}")

            has_multimodal_part = True
            continue

        if item_type == "text":
            text_value = _stringify_input_value(item.value).strip()
            if not text_value:
                continue
            label = item.name or "input"
            text_part = f"{label}: {text_value}"
            raw_parts.append({"text": text_part})
            if genai_types is not None:
                sdk_parts.append(genai_types.Part.from_text(text=text_part))

    if not has_multimodal_part:
        return request.message or prompt_text

    if genai_types is not None and sdk_has_multimodal_part:
        return [genai_types.Content(role="user", parts=sdk_parts)]

    return [{"role": "user", "parts": raw_parts}]


def _strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```") and cleaned.endswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 2:
            body = "\n".join(lines[1:-1]).strip()
            return body
    return cleaned


def _coerce_to_python_object(text: str) -> Any:
    cleaned = _strip_code_fence(text)
    if cleaned == "":
        return ""

    try:
        return json.loads(cleaned)
    except Exception:
        pass

    try:
        return ast.literal_eval(cleaned)
    except Exception:
        pass

    fragment = _extract_structured_fragment(cleaned)
    if fragment is not None:
        try:
            return json.loads(fragment)
        except Exception:
            pass
        try:
            return ast.literal_eval(fragment)
        except Exception:
            pass

    lowered = cleaned.lower()
    if lowered == "none" or lowered == "null":
        return None
    if lowered == "true":
        return True
    if lowered == "false":
        return False

    try:
        if cleaned.isdigit() or (cleaned.startswith("-") and cleaned[1:].isdigit()):
            return int(cleaned)
        return float(cleaned)
    except Exception:
        return cleaned


def _extract_structured_fragment(text: str) -> str | None:
    candidates: list[str] = []

    def _collect_balanced(open_char: str, close_char: str) -> None:
        start = text.find(open_char)
        if start == -1:
            return

        depth = 0
        in_string = False
        escaped = False
        quote_char = ""

        for index in range(start, len(text)):
            ch = text[index]

            if in_string:
                if escaped:
                    escaped = False
                    continue
                if ch == "\\":
                    escaped = True
                    continue
                if ch == quote_char:
                    in_string = False
                continue

            if ch == '"' or ch == "'":
                in_string = True
                quote_char = ch
                continue

            if ch == open_char:
                depth += 1
            elif ch == close_char:
                depth -= 1
                if depth == 0:
                    fragment = text[start : index + 1].strip()
                    if fragment:
                        candidates.append(fragment)
                    return

    _collect_balanced("{", "}")
    _collect_balanced("[", "]")

    if not candidates:
        return None

    for candidate in sorted(candidates, key=len, reverse=True):
        if candidate.startswith("{") and candidate.endswith("}"):
            return candidate
    return sorted(candidates, key=len, reverse=True)[0]


def _extract_retry_after_seconds(error_text: str) -> int | None:
    patterns = [
        r"retry in\s+([0-9]+(?:\.[0-9]+)?)s",
        r"retryDelay['\"]?\s*:\s*['\"]([0-9]+)s['\"]",
    ]
    for pattern in patterns:
        match = re.search(pattern, error_text, re.IGNORECASE)
        if match:
            try:
                return max(1, int(float(match.group(1))))
            except Exception:
                return None
    return None


database_url = os.getenv("DATABASE_URL")

if database_url:
    engine = create_engine(database_url, pool_pre_ping=True)
else:
    sqlite_file_name = os.getenv("SQLITE_FILE", "database.db")
    sqlite_url = f"sqlite:///{sqlite_file_name}"
    connect_args = {"check_same_thread": False}
    engine = create_engine(sqlite_url, connect_args=connect_args)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def migrate_canvas_owner_sub_column() -> None:
    with engine.begin() as connection:
        table_info = connection.execute(text("PRAGMA table_info(canvas)"))
        columns = {row[1] for row in table_info}

        if "owner_sub" not in columns:
            connection.execute(
                text("ALTER TABLE canvas ADD COLUMN owner_sub TEXT NOT NULL DEFAULT ''")
            )

        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_canvas_owner_sub ON canvas(owner_sub)"
            )
        )


def get_session():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]

# --- APP INITIALIZATION ---
app = FastAPI(title="Auth0 FastAPI Example")
frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")


def _normalize_origin(origin: str) -> str:
    return origin.strip().rstrip("/")


cors_allowed_origins_env = os.getenv("CORS_ALLOWED_ORIGINS")
if cors_allowed_origins_env:
    cors_allowed_origins = [
        _normalize_origin(origin)
        for origin in cors_allowed_origins_env.split(",")
        if origin.strip()
    ]
else:
    cors_allowed_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        _normalize_origin(frontend_base_url),
    ]

app_base_url = os.getenv("APP_BASE_URL", "http://localhost:8000")
normalized_app_origin = _normalize_origin(app_base_url)
if normalized_app_origin not in cors_allowed_origins:
    cors_allowed_origins.append(normalized_app_origin)


def _safe_frontend_path(next_path: str, fallback: str) -> str:
    if not next_path:
        return fallback
    if not next_path.startswith("/"):
        return fallback
    if next_path.startswith("//"):
        return fallback
    return next_path


@app.middleware("http")
async def redirect_declined_auth_to_dashboard(request: Request, call_next):
    if request.url.path == "/auth/callback":
        auth_error = request.query_params.get("error")
        if auth_error:
            return RedirectResponse(url=f"{frontend_base_url}/dashboard")

    return await call_next(request)

session_secret = os.getenv("SESSION_SECRET")
if not session_secret:
    raise RuntimeError("Missing SESSION_SECRET in environment variables.")

app.add_middleware(SessionMiddleware, secret_key=session_secret)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

config = Auth0Config(
    domain=os.getenv("AUTH0_DOMAIN"),
    client_id=os.getenv("AUTH0_CLIENT_ID"),
    client_secret=os.getenv("AUTH0_CLIENT_SECRET"),
    app_base_url=app_base_url,
    secret=session_secret,
    authorization_params={"scope": "openid profile email"},
)

auth_client = AuthClient(config)

app.state.config = config
app.state.auth_client = auth_client


async def get_current_user_sub(
    request: Request,
    response: Response,
    session: dict[str, Any] = Depends(auth_client.require_session),
) -> str:
    store_options = {"request": request, "response": response}
    user = await auth_client.client.get_user(store_options=store_options)
    sub = user.get("sub") if user else None
    if not sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return sub


CurrentUserSubDep = Annotated[str, Depends(get_current_user_sub)]

register_auth_routes(router, config)
app.include_router(router)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    migrate_canvas_owner_sub_column()

# 4. GEMINI CHAT ENDPOINT
@app.post("/api/chat")
async def chat_with_ai(request: ChatRequest):
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured. Install google-genai and set GEMINI_API_KEY.",
        )

    try:
        contents = _build_gemini_contents(request)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config={
                "system_instruction": GEMINI_SYSTEM_PROMPT
            }
        )
        reply_text = (response.text or "").strip()
        output_value = _coerce_to_python_object(reply_text)
        return {"reply": reply_text, "output": output_value}
    except Exception as e:
        raw_error = str(e)
        print(f"\n🔥 GEMINI CRASH REASON: {raw_error}\n")

        if isinstance(e, HTTPException):
            raise e

        error_upper = raw_error.upper()
        is_quota_error = "RESOURCE_EXHAUSTED" in error_upper or "QUOTA" in error_upper
        is_rate_error = "429" in raw_error or "RATE LIMIT" in error_upper

        if is_quota_error or is_rate_error:
            retry_after = _extract_retry_after_seconds(raw_error)
            detail = (
                "Gemini API quota/rate limit reached. "
                "Please retry shortly, use a different model, or check billing/quota limits."
            )
            headers = {"Retry-After": str(retry_after)} if retry_after else None
            raise HTTPException(status_code=429, detail=detail, headers=headers)

        raise HTTPException(status_code=500, detail=f"Gemini request failed: {raw_error}")


def get_owned_canvas_or_404(session: Session, canvas_id: str, owner_sub: str) -> Canvas:
    canvas = session.get(Canvas, canvas_id)
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    if canvas.owner_sub == owner_sub:
        return canvas

    if canvas.owner_sub == "":
        canvas.owner_sub = owner_sub
        session.add(canvas)
        session.commit()
        session.refresh(canvas)
        return canvas

    raise HTTPException(status_code=404, detail="Canvas not found")


# User CRUD
@app.post("/users/")
def create_user(user: User, session: SessionDep) -> User:
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@app.get("/users/")
def read_users(
    session: SessionDep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
) -> list[User]:
    users = session.exec(select(User).offset(offset).limit(limit)).all()
    return users


@app.get("/users/{user_id}")
def read_user(user_id: int, session: SessionDep) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.delete("/users/{user_id}")
def delete_user(user_id: int, session: SessionDep):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    session.delete(user)
    session.commit()
    return {"ok": True}


# Canvas CRUD
@app.post("/canvas/", response_model=Canvas)
def create_canvas(
    canvas_in: CanvasCreate,
    session: SessionDep,
    current_user_sub: CurrentUserSubDep,
) -> Canvas:
    canvas = Canvas(name=canvas_in.name, owner_sub=current_user_sub)
    session.add(canvas)
    session.commit()
    session.refresh(canvas)
    return canvas


@app.get("/canvas/", response_model=list[Canvas])
def read_canvases(
    session: SessionDep,
    current_user_sub: CurrentUserSubDep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
) -> list[Canvas]:
    canvases = session.exec(
        select(Canvas)
        .where(Canvas.owner_sub == current_user_sub)
        .offset(offset)
        .limit(limit)
    ).all()
    return canvases


@app.get("/canvas/{canvas_id}", response_model=Canvas)
def read_canvas(
    canvas_id: str,
    session: SessionDep,
    current_user_sub: CurrentUserSubDep,
) -> Canvas:
    return get_owned_canvas_or_404(session, canvas_id, current_user_sub)


@app.delete("/canvas/{canvas_id}")
def delete_canvas(
    canvas_id: str,
    session: SessionDep,
    current_user_sub: CurrentUserSubDep,
):
    canvas = get_owned_canvas_or_404(session, canvas_id, current_user_sub)

    shapes = session.exec(select(Shape).where(Shape.canvas_id == canvas_id)).all()
    for shape in shapes:
        session.delete(shape)

    session.delete(canvas)
    session.commit()
    return {"ok": True}


# Shape CRUD

@app.get("/canvas/{canvas_id}/shapes")
def read_shapes(
    canvas_id: str,
    session: SessionDep,
    current_user_sub: CurrentUserSubDep,
) -> list[Shape]:
    get_owned_canvas_or_404(session, canvas_id, current_user_sub)
    shapes = session.exec(select(Shape).where(Shape.canvas_id == canvas_id)).all()
    return shapes


@app.post("/canvas/{canvas_id}/shapes")
def batch_save_shape(
    canvas_id: str,
    shapes: list[TLShape],
    session: SessionDep,
    current_user_sub: CurrentUserSubDep,
):
    get_owned_canvas_or_404(session, canvas_id, current_user_sub)
    existing = session.exec(select(Shape).where(Shape.canvas_id == canvas_id)).all()
    for shape in existing:
        session.delete(shape)

    db_shapes = []
    for shape in shapes:
        db_shape = Shape(
            id=shape.id,
            canvas_id=canvas_id,
            type=shape.type,
            data=shape.model_dump(),
        )
        session.add(db_shape)
        db_shapes.append(db_shape)

    session.commit()
    return db_shapes


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse(url=f"{frontend_base_url}/")


@app.get("/post-login")
def post_login(next: str = "/dashboard"):
    safe_next = _safe_frontend_path(next, "/dashboard")
    return RedirectResponse(url=f"{frontend_base_url}{safe_next}")


@app.get("/post-logout")
def post_logout(next: str = "/login"):
    safe_next = _safe_frontend_path(next, "/login")
    return RedirectResponse(url=f"{frontend_base_url}{safe_next}")


@app.get("/logout")
def logout(request: Request, next: str = "/dashboard"):
    safe_next = _safe_frontend_path(next, "/dashboard")
    request.session.clear()
    response = RedirectResponse(url=f"{frontend_base_url}{safe_next}")

    cookie_names = set(request.cookies.keys())
    cookie_names.update({"session", "appSession", "auth0"})

    for cookie_name in cookie_names:
        response.delete_cookie(cookie_name, path="/")
        response.delete_cookie(cookie_name, path="/auth")

    return response


@app.post("/logout-session")
def logout_session(request: Request):
    request.session.clear()
    json_response = JSONResponse(content={"ok": True})

    cookie_names = set(request.cookies.keys())
    cookie_names.update({"session", "appSession", "auth0"})

    for cookie_name in cookie_names:
        json_response.delete_cookie(cookie_name, path="/")
        json_response.delete_cookie(cookie_name, path="/auth")

    return json_response


@app.get("/profile")
async def profile(
    request: Request,
    response: Response,
    session: dict[str, Any] = Depends(auth_client.require_session),
):
    store_options = {"request": request, "response": response}
    user = await auth_client.client.get_user(store_options=store_options)
    return {"message": "Your Profile", "user": user, "session_details": session}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)