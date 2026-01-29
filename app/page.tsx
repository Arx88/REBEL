import { Dashboard } from "@/components/dashboard/dashboard"

export default function Home() {
  console.log("[v0] Home page rendering")
  return (
    <main className="min-h-screen bg-background">
      <Dashboard />
    </main>
  )
}
