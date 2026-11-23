import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLots from "./tools/list-lots";
import listSublots from "./tools/list-sublots";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "tag-flow-pro",
  title: "Tag Flow Pro",
  version: "0.1.0",
  instructions: "Read-only tools for the Tagging Line app: list lots and sublots with their workflow status. Results follow the signed-in user's permissions.",
  auth: auth.oauth.issuer({ issuer: `https://${projectRef}.supabase.co/auth/v1`, acceptedAudiences: "authenticated" }),
  tools: [listLots, listSublots],
});
