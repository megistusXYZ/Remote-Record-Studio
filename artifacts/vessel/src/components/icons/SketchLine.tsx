import * as React from "react";

export function SketchLine(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 200 10"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3,5 Q 20,3.4 38,5.2 T 76,5 T 116,4.8 T 156,5.4 T 197,5" />
    </svg>
  );
}
