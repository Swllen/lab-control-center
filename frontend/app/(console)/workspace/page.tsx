import { redirect } from "next/navigation";

// Keep old bookmarks useful; tools now dock directly into any page.
export default function WorkspacePage() {
  redirect("/files");
}
