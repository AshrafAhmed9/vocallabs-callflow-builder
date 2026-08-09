import { NavBar } from "@/components/NavBar";
import { RequireAuth } from "@/components/RequireAuth";

export default function WorkflowsLayout({ children }: LayoutProps<"/workflows">) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <NavBar />
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
      </div>
    </RequireAuth>
  );
}
