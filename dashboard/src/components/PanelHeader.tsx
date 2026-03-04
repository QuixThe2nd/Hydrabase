import { BORD, MUTED } from "../theme";

export const PanelHeader = ({ label, right }: { label: string; right?: string }) => <div style={{ alignItems: "center", borderBottom: `1px solid ${BORD}`, display: "flex", justifyContent: "space-between", padding: "8px 14px" }}>
  <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
  {right && <span style={{ color: MUTED, fontSize: 10 }}>{right}</span>}
</div>
