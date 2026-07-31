import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kiran Voice Documents",
    short_name: "Kiran Docs",
    description: "Create approval notes using voice and an Excel data source.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f6fb",
    theme_color: "#183a70",
  };
}
