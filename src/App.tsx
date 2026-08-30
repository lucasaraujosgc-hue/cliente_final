/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ClientLayout, AccountantLayout } from "./components/Layouts";
import { ClientDashboardSkeleton } from "./components/Skeleton";

// Route components are code-split so heavy libs (recharts, xlsx, pdfjs-dist,
// firebase) only load on the pages that actually use them. Named exports, so
// each import() is mapped to a default.
const named = <T extends Record<string, any>, K extends keyof T>(
  loader: () => Promise<T>,
  key: K,
) => lazy(() => loader().then((m) => ({ default: m[key] })));

const Login = named(() => import("./pages/Auth"), "Login");
const AccountantLogin = named(() => import("./pages/Auth"), "AccountantLogin");
const SetupProfile = named(() => import("./pages/client/SetupProfile"), "SetupProfile");
const ClientDashboard = named(() => import("./pages/client/Dashboard"), "ClientDashboard");
const ClientOverdue = named(() => import("./pages/client/Overdue"), "ClientOverdue");
const ClientVault = named(() => import("./pages/client/Vault"), "ClientVault");
const ClientUploads = named(() => import("./pages/client/MyUploads"), "ClientUploads");
const AccountantDashboard = named(() => import("./pages/accountant/Dashboard"), "AccountantDashboard");
const ClientsList = named(() => import("./pages/accountant/ClientsList"), "ClientsList");
const ClientDetail = named(() => import("./pages/accountant/ClientDetail"), "ClientDetail");
const AccountantNotifications = named(() => import("./pages/accountant/Notifications"), "AccountantNotifications");
const AccountantPayments = named(() => import("./pages/accountant/Payments"), "AccountantPayments");
const FileGallery = named(() => import("./pages/accountant/FileGallery"), "FileGallery");
const Settings = named(() => import("./pages/accountant/Settings"), "Settings");
const Devices = named(() => import("./pages/accountant/Devices"), "Devices");
const Audit = named(() => import("./pages/accountant/Audit"), "Audit");

export default function App() {
  return (
    // @ts-ignore
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Router>
        <Suspense fallback={<ClientDashboardSkeleton />}>
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
              <Route path="payments" element={<AccountantPayments />} />
              <Route path="devices" element={<Devices />} />
              <Route path="audit" element={<Audit />} />
              <Route path="gallery" element={<FileGallery />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </ThemeProvider>
  );
}
