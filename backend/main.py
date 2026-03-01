import os
import uuid as uuid_lib
from typing import Annotated, Any

from auth0_fastapi.auth.auth_client import AuthClient
from auth0_fastapi.config import Auth0Config
from auth0_fastapi.server.routes import register_auth_routes, router
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlmodel import Field, Relationship, Session, SQLModel, create_engine, select
from datetime import datetime, timezone
from sqlalchemy import Column, JSON, text
from starlette.middleware.sessions import SessionMiddleware

# 1. NEW IMPORT FOR GEMINI
from google import genai

load_dotenv()

# 2. INITIALIZE GEMINI CLIENT
# Make sure GEMINI_API_KEY is in your .env file
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

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
class ChatRequest(BaseModel):
    message: str


sqlite_file_name = "database.db"
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
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

config = Auth0Config(
    domain=os.getenv("AUTH0_DOMAIN"),
    client_id=os.getenv("AUTH0_CLIENT_ID"),
    client_secret=os.getenv("AUTH0_CLIENT_SECRET"),
    app_base_url=os.getenv("APP_BASE_URL", "http://localhost:8000"),
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
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=request.message,
            config={
                "system_instruction": "You are a helpful coding assistant on an application that uses Tldraw canvas to run code python code within the browser. Users will ask you questions on how to use Tldraw and coding questions Be concise."
            }
        )
        return {"reply": response.text}
    except Exception as e:
        print(f"\n🔥 GEMINI CRASH REASON: {str(e)}\n")
        raise HTTPException(status_code=500, detail=str(e))


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