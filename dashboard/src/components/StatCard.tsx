import { MUTED, panel, TEXT } from "../theme";
import { Sparkline } from "./SparkLine"

export const StatCard = ({ color = TEXT, label, spark, sub, value }: { color?: string; label: string; spark?: number[]; sub: string; value: number | string }) => <div style={panel()}>
  <div style={{ padding: "12px 14px" }}>
    <div style={{ color: MUTED, fontSize: 9, letterSpacing: "0.12em", marginBottom: 5, textTransform: "uppercase" }}>{label}</div>
    <div style={{ alignItems: "flex-end", display: "flex", justifyContent: "space-between" }}>
      <div>
        <div style={{ color, fontFamily: "monospace", fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ color: MUTED, fontSize: 9, marginTop: 3 }}>{sub}</div>}
      </div>
      {spark && <Sparkline color={color} data={spark} />}
    </div>
  </div>
</div>
