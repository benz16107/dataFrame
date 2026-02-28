import os
from typing import Annotated, Any

from auth0_fastapi.auth.auth_client import AuthClient
from auth0_fastapi.config import Auth0Config
from auth0_fastapi.server.routes import register_auth_routes, router
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from sqlmodel import Field, Session, SQLModel, create_engine, select
from starlette.middleware.sessions import SessionMiddleware


load_dotenv()


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    email: str = Field(index=True, unique=True)


sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]

app = FastAPI(title="Auth0 FastAPI Example")

session_secret = os.getenv("SESSION_SECRET")
if not session_secret:
    raise RuntimeError("Missing SESSION_SECRET in environment variables.")

app.add_middleware(SessionMiddleware, secret_key=session_secret)

config = Auth0Config(
    domain=os.getenv("AUTH0_DOMAIN"),
    client_id=os.getenv("AUTH0_CLIENT_ID"),
    client_secret=os.getenv("AUTH0_CLIENT_SECRET"),
    app_base_url=os.getenv("APP_BASE_URL", "http://localhost:3000"),
    secret=session_secret,
    authorization_params={"scope": "openid profile email"},
)

auth_client = AuthClient(config)

app.state.config = config
app.state.auth_client = auth_client

register_auth_routes(router, config)
app.include_router(router)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


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


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "Backend is running.",
        "auth": "Visit /auth/login to start Auth0 login.",
    }


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

    uvicorn.run(app, host="0.0.0.0", port=3000)