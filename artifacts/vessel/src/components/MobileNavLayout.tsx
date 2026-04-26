import * as React from "react";
import { MobileBottomNav } from "./MobileBottomNav";

export function MobileNavLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="md:pb-0 pb-[calc(72px+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <MobileBottomNav />
    </>
  );
}
