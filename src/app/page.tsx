/** Public entry: always open the product homepage. */
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/workbench/home");
}
