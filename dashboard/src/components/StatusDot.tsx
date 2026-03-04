import type { ApiPeer } from "../../../src/StatsReporter";

import { STATUS_COLORS } from "../theme";

export const StatusDot = ({ status }: { status: ApiPeer["status"] }) => <span style={{ background: STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? "#888", borderRadius: "50%", boxShadow: status === "connected" ? `0 0 6px ${STATUS_COLORS.connected}` : "none", display: "inline-block", flexShrink: 0, height: 7, marginRight: 5, width: 7 }} />

