// src/pages/home.tsx
import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div className="app-shell">
      <div className="app-card app-card-sm app-center">
        <h1 className="app-title">Welcome to TreeHacks</h1>
        <p className="app-subtitle">Jump into your workspace and continue building.</p>
        <div className="app-actions">
          <Link to="/login" className="dash-btn dash-btn-primary">
            Go to Login
          </Link>
          <Link to="/dashboard" className="dash-btn dash-btn-outline">
            Open Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}