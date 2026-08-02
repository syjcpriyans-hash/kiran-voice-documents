import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kiran AI Memorandum Assistant",
    short_name: "Kiran Assistant",
    description: "Voice-first memorandum operations connected to Google Sheets.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#005090",
  };
}
