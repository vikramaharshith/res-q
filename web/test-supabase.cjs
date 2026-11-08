async function main() {
  const fs = await import("node:fs");
  const { createClient } = await import("@supabase/supabase-js");

  const env = fs.readFileSync(".env.local", "utf8");
  const get = (key) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();

  const supabase = createClient(
    get("NEXT_PUBLIC_SUPABASE_URL"),
    get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  );

  const { error } = await supabase.from("incidents").select("id").limit(1);
  console.log("Supabase response:", error?.message || "Query successful");
}

void main();
