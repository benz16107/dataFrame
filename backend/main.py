import os
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse
from sqlmodel import Field, Session, SQLModel, create_engine, select
from starlette.middleware.sessions import SessionMiddleware

from auth0_fastapi.auth.auth_client import AuthClient
from auth0_fastapi.config import Auth0Config
from auth0_fastapi.server.routes import router, register_auth_routes

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

# Load environment variables
load_dotenv()

app = FastAPI(title="Auth0 FastAPI Example")

# Add Session Middleware - required for cookie handling
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SESSION_SECRET"))

# Create Auth0Config with your Auth0 credentials
config = Auth0Config(
    domain=os.getenv("AUTH0_DOMAIN"),
    client_id=os.getenv("AUTH0_CLIENT_ID"),
    client_secret=os.getenv("AUTH0_CLIENT_SECRET"),
    app_base_url=os.getenv("APP_BASE_URL", "http://localhost:3000"),
    secret=os.getenv("SESSION_SECRET"),
    authorization_params={
      "scope": "openid profile email", # Required to get user profile information
    }
)

# Instantiate the AuthClient
auth_client = AuthClient(config)

# Attach to the FastAPI app state
app.state.config = config
app.state.auth_client = auth_client

# Register authentication routes
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

@app.get("/", response_class=HTMLResponse)
async def home(request: Request, response: Response):
    """Home page with login/logout buttons"""
    store_options = {"request": request, "response": response}
    session = await auth_client.client.get_session(store_options=store_options)

    if session:
        user = await auth_client.client.get_user(store_options=store_options)
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Auth0 FastAPI Example</title>
            <style>
                body {{
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    background-color: #1a1e27;
                    color: #e2e8f0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                }}
                .container {{
                    background-color: #262a33;
                    border-radius: 20px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
                    padding: 3rem;
                    max-width: 500px;
                    width: 90%;
                    text-align: center;
                }}
                .logo {{
                    width: 160px;
                    margin-bottom: 1.5rem;
                }}
                h1 {{
                    font-size: 2.8rem;
                    font-weight: 700;
                    color: #f7fafc;
                    margin-bottom: 1rem;
                }}
                .success {{
                    font-size: 1.5rem;
                    color: #68d391;
                    font-weight: 600;
                    margin: 1.5rem 0;
                }}
                .profile {{
                    background-color: #2d313c;
                    border-radius: 15px;
                    padding: 2rem;
                    margin: 2rem 0;
                }}
                .profile-image {{
                    width: 110px;
                    height: 110px;
                    border-radius: 50%;
                    border: 3px solid #63b3ed;
                    margin-bottom: 1rem;
                }}
                .profile-name {{
                    font-size: 2rem;
                    font-weight: 600;
                    color: #f7fafc;
                    margin-bottom: 0.5rem;
                }}
                .profile-email {{
                    font-size: 1.15rem;
                    color: #a0aec0;
                }}
                .button {{
                    padding: 1.1rem 2.8rem;
                    font-size: 1.2rem;
                    font-weight: 600;
                    border-radius: 10px;
                    border: none;
                    cursor: pointer;
                    text-decoration: none;
                    display: inline-block;
                    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }}
                .button.logout {{
                    background-color: #fc8181;
                    color: #1a1e27;
                }}
                .button.logout:hover {{
                    background-color: #e53e3e;
                    transform: translateY(-5px) scale(1.03);
                    box-shadow: 0 12px 25px rgba(0, 0, 0, 0.5);
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <img src="https://cdn.auth0.com/quantum-assets/dist/latest/logos/auth0/auth0-lockup-en-ondark.png"
                     alt="Auth0 Logo" class="logo">
                <h1>Welcome to Auth0 FastAPI</h1>
                <div class="success">✅ Successfully authenticated!</div>
                <h2>Your Profile</h2>
                <div class="profile">
                    <img src="{user.get('picture', '')}"
                         alt="{user.get('name', 'User')}" class="profile-image">
                    <div class="profile-name">{user.get('name', 'User')}</div>
                    <div class="profile-email">{user.get('email', '')}</div>
                </div>
                <a href="/auth/logout" class="button logout">Log Out</a>
            </div>
        </body>
        </html>
        """
    else:
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Auth0 FastAPI Example</title>
            <style>
                body {
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    background-color: #1a1e27;
                    color: #e2e8f0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                }
                .container {
                    background-color: #262a33;
                    border-radius: 20px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
                    padding: 3rem;
                    max-width: 500px;
                    width: 90%;
                    text-align: center;
                }
                .logo {
                    width: 160px;
                    margin-bottom: 1.5rem;
                }
                h1 {
                    font-size: 2.8rem;
                    font-weight: 700;
                    color: #f7fafc;
                    margin-bottom: 1rem;
                }
                .action-card {
                    background-color: #2d313c;
                    border-radius: 15px;
                    padding: 2.5rem;
                    margin-top: 2rem;
                }
                .action-text {
                    font-size: 1.25rem;
                    color: #cbd5e0;
                    margin-bottom: 1.8rem;
                }
                .button {
                    padding: 1.1rem 2.8rem;
                    font-size: 1.2rem;
                    font-weight: 600;
                    border-radius: 10px;
                    border: none;
                    cursor: pointer;
                    text-decoration: none;
                    display: inline-block;
                    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }
                .button.login {
                    background-color: #63b3ed;
                    color: #1a1e27;
                }
                .button.login:hover {
                    background-color: #4299e1;
                    transform: translateY(-5px) scale(1.03);
                    box-shadow: 0 12px 25px rgba(0, 0, 0, 0.5);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <img src="https://cdn.auth0.com/quantum-assets/dist/latest/logos/auth0/auth0-lockup-en-ondark.png"
                     alt="Auth0 Logo" class="logo">
                <h1>Welcome to Auth0 FastAPI</h1>
                <div class="action-card">
                    <p class="action-text">Get started by signing in to your account</p>
                    <a href="/auth/login" class="button login">Log In</a>
                </div>
            </div>
        </body>
        </html>
        """


@app.get("/profile")
async def profile(
    request: Request,
    response: Response,
    session=Depends(auth_client.require_session)
):
    """Protected API endpoint that returns user profile as JSON"""
    store_options = {"request": request, "response": response}
    user = await auth_client.client.get_user(store_options=store_options)

    return {
        "message": "Your Profile",
        "user": user,
        "session_details": session
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)