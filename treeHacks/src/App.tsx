// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import './App.css'
import LoginPage from './pages/login' // Make sure this matches your exact filename!
import CanvasPage from "./pages/canvas";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/canvas" element={<CanvasPage />} />

        <Route path="/" element={
          <div className="flex flex-col items-center justify-center min-h-screen">
            <h1 className="text-4xl font-bold">Welcome to TreeHacks!</h1>
            <a href="/login" className="mt-4 text-blue-500 hover:underline">
              Go to Login Page
            </a>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  )
}

export default App;