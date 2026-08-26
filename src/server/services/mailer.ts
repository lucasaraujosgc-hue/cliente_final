import nodemailer from "nodemailer";
import { Resend } from "resend";

// Email Transporter (SMTP - Hostinger by default)
export const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.hostinger.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Resend client (used as an alternative/additional email channel)
export const resend = new Resend(process.env.RESEND_API_KEY || "re_123");
