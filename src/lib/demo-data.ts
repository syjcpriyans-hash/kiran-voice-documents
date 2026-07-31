import type { ApprovalDraft } from "@/lib/types";

export const demoDraft: ApprovalDraft = {
  recipientName: "Hitesh S Sanghavi",
  recipientType: "Broker",
  through: "",
  date: "2026-07-25",
  items: [
    { id: "1", size: "1/4", description: "[ PE ] [ VVS-1 (FG) ]", carats: 37.37, askingPrice: 45000, remarks: "" },
    { id: "2", size: "1/5", description: "[ PE ] [ VVS-1 (FG) ]", carats: 38.44, askingPrice: 45000, remarks: "" },
    { id: "3", size: "1/6", description: "[ PE ] [ VVS-1 (FG) ]", carats: 25.29, askingPrice: 45000, remarks: "" },
    { id: "4", size: "1/10", description: "[ PE ] [ VVS-1 (FG) ]", carats: 15.79, askingPrice: 45000, remarks: "" },
    { id: "5", size: "1/4", description: "[ MQ ] [ VVS-1 (FG) ]", carats: 37.74, askingPrice: 45000, remarks: "" },
    { id: "6", size: "1/5", description: "[ MQ ] [ VVS-1 (FG) ]", carats: 37.83, askingPrice: 45000, remarks: "" },
    { id: "7", size: "1/6", description: "[ MQ ] [ VVS-1 (FG) ]", carats: 25.18, askingPrice: 45000, remarks: "" },
    { id: "8", size: "1/10", description: "[ MQ ] [ VVS-1 (FG) ]", carats: 15.73, askingPrice: 45000, remarks: "" },
  ],
};
