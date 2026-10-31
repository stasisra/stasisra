import { redirect } from "next/navigation";
export default function NamesSettings() {
  redirect("/dashboard/dictionaries?type=executors");
}
