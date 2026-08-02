import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kiran Memorandum Assistant",
    short_name: "Kiran Assistant",
    description: "Create and manage approval notes using voice and Google Sheets.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#005090",
  };
}
