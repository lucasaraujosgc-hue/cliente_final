export interface Client {
  id: string;
  cnpj: string; // Storing the numeric part or formatted? Let's just keep as string (formatted or raw)
  name: string;
  passwordHash: string; // Fake hash for simple prototype
  regularityStatus: "green" | "warning" | "red";
  email?: string;
  firstAccessDone?: boolean;
  integrationHash?: string;
}

export interface Document {
  id: string;
  clientId: string;
  title: string;
  category: "company" | "taxes" | "payroll" | "upload" | "other";
  dueDate?: string; // ISO date string
  status: "pending" | "paid" | "viewed" | "new";
  uploadedBy: "accountant" | "client";
  createdAt: string;
  fileUrl?: string; // Fake URL
}

export interface BillingData {
  id: string;
  clientId: string;
  month: string; // e.g. "2026-06"
  revenue: number;
  expenses: number;
  payroll: number;
}

export interface Message {
  id: string;
  clientId: string;
  content: string;
  createdAt: string;
  read: boolean;
}
