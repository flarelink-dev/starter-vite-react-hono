import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Login } from './pages/Login.tsx';
import { Signup } from './pages/Signup.tsx';
import { Notes } from './pages/Notes.tsx';
import { RequireAuth } from './components/RequireAuth.tsx';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Notes />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
