import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { Dashboard } from "./routes/Dashboard";
import { Errores } from "./routes/Errores";
import { Login } from "./routes/Login";
import { RemitoDetailPage } from "./routes/RemitoDetailPage";
import { RemitosList } from "./routes/RemitosList";
import { Review } from "./routes/Review";
import { Upload } from "./routes/Upload";

/** Las 5 pantallas de PRD §18 + "Errores" (post-MVP). Todo salvo `/login`
 * pasa por `RequireAuth`. */
function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="remitos" element={<RemitosList />} />
          <Route path="remitos/:id" element={<RemitoDetailPage />} />
          <Route path="escanear" element={<Upload />} />
          <Route path="revision" element={<Review />} />
          <Route path="errores" element={<Errores />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
