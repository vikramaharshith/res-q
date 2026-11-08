import { handleApprovalRequest } from "@/lib/approval/handle-decision";
import { supabaseApprovalStore } from "@/lib/approval/supabase-store";

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleApprovalRequest(request, {
    secret: process.env.SUPABASE_SECRET_KEY?.trim() || null,
    enabled: process.env.RESQ_LOCAL_APPROVALS === "1",
    store: supabaseApprovalStore,
  });
}
