import * as React from "react";

export function SketchCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M52,7 C74,6 92,25 94,49 C96,73 75,93 50,94 C25,95 6,75 6,50 C6,27 27,8 52,7 Z" />
      <path d="M48,10 C71,9 93,28 91,52 C90,75 69,92 46,90 C23,88 9,69 11,46 C13,25 28,11 48,10" opacity="0.55" />
    </svg>
  );
}
