"use client";

import { Prose } from "@/components/Prose";
import { docs } from "@/content/pages";

export default function DocsPage() {
  return <Prose content={docs} />;
}
