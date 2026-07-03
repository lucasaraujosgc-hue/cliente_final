/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ClientLayout, AccountantLayout } from "./components/Layouts";
import { Login, AccountantLogin } from "./pages/Auth";
import { ClientDashboard } from "./pages/client/Dashboard";
import { ClientOverdue } from "./pages/client/Overdue";
import { ClientVault } from "./pages/client/Vault";
import { ClientUploads } from "./pages/client/MyUploads";
import { SetupProfile } from "./pages/client/SetupProfile";
import { AccountantDashboard } from "./pages/accountant/Dashboard";
import { ClientsList } from "./pages/accountant/ClientsList";
import { ClientDetail } from "./pages/accountant/ClientDetail";
import { AccountantNotifications } from "./pages/accountant/Notifications";
import { FileGallery } from "./pages/accountant/FileGallery";
import { Settings } from "./pages/accountant/Settings";

export default function App() {
  return (
    // @ts-ignore
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Router>
        <Routes>
          {/* Auth */}
          <Route path="/login" element={<Login />} />
          <Route path="/setup-profile" element={<SetupProfile />} />
          <Route path="/admin/login" element={<AccountantLogin />} />

          {/* Client Routes */}
          <Route element={<ClientLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<ClientDashboard />} />
            <Route path="/overdue" element={<ClientOverdue />} />
            <Route path="/vault" element={<ClientVault />} />
            <Route path="/uploads" element={<ClientUploads />} />
          </Route>

          {/* Accountant Routes */}
          <Route path="/admin" element={<AccountantLayout />}>
            <Route index element={<AccountantDashboard />} />
            <Route path="clients" element={<ClientsList />} />
            <Route path="client/:id" element={<ClientDetail />} />
            <Route path="notifications" element={<AccountantNotifications />} />
            <Route path="gallery" element={<FileGallery />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

