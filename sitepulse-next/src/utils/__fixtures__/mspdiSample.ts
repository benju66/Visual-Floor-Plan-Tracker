/**
 * Trimmed MSPDI fixture, derived from the REAL export at
 * `docs/Schdules/real_project_schedule.xml` (ORCHARD PATH III, 118 tasks).
 *
 * It preserves every structural quirk the parser must survive, at 1/10th the size:
 *   - the MSPDI default namespace + project-level <Title>/<Name>,
 *   - a duplicated root summary pair (OutlineLevel 0 and 1, same name),
 *   - `<IsNull>1</IsNull>` blank spacer rows (MS Project exports empty grid rows),
 *   - an `<Active>0</Active>` deactivated task,
 *   - zero-duration `<Milestone>1</Milestone>` markers,
 *   - a deep summary chain (LOW RISE APARTMENT → INTERIOR FINISHES →
 *     LEVEL 4 FINISHES (19 UNITS) → leaf activities) — the shape the level
 *     suggestion heuristic reads,
 *   - `<PredecessorLink>` blocks with nested elements (direct-child lookups must
 *     not leak into them),
 *   - XML entities in names (TAPE &amp; SAND).
 */
export const MSPDI_SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
	<SaveVersion>14</SaveVersion>
	<Name>real_project_schedule.xml</Name>
	<Title>ORCHARD PATH III</Title>
	<ScheduleFromStart>1</ScheduleFromStart>
	<StartDate>2025-05-01T07:00:00</StartDate>
	<FinishDate>2026-06-01T15:30:00</FinishDate>
	<MinutesPerDay>480</MinutesPerDay>
	<Tasks>
		<Task>
			<UID>0</UID>
			<ID>0</ID>
			<Name>ORCHARD PATH III</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>1</WBS>
			<OutlineLevel>0</OutlineLevel>
			<Start>2025-05-01T07:00:00</Start>
			<Finish>2026-06-01T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>1</Summary>
		</Task>
		<Task>
			<UID>193</UID>
			<ID>1</ID>
			<Name>ORCHARD PATH III</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188</WBS>
			<OutlineLevel>1</OutlineLevel>
			<Start>2025-05-01T07:00:00</Start>
			<Finish>2026-06-01T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>1</Summary>
		</Task>
		<Task>
			<UID>2596</UID>
			<ID>2</ID>
			<Name>CONSTRUCTION DURATION</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.103</WBS>
			<OutlineLevel>2</OutlineLevel>
			<Start>2025-05-01T07:00:00</Start>
			<Finish>2026-06-01T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>1</Summary>
		</Task>
		<Task>
			<UID>2595</UID>
			<ID>3</ID>
			<Name>START CONSTRUCTION</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.103.1</WBS>
			<OutlineLevel>3</OutlineLevel>
			<Start>2025-05-01T07:00:00</Start>
			<Finish>2025-05-01T07:00:00</Finish>
			<Milestone>1</Milestone>
			<Summary>0</Summary>
		</Task>
		<Task>
			<UID>2597</UID>
			<ID>5</ID>
			<Name></Name>
			<Active>1</Active>
			<IsNull>1</IsNull>
			<OutlineLevel>0</OutlineLevel>
			<Start>2025-05-01T07:00:00</Start>
			<Finish>2025-05-01T07:00:00</Finish>
			<Milestone>0</Milestone>
			<Summary>0</Summary>
		</Task>
		<Task>
			<UID>1</UID>
			<ID>6</ID>
			<Name>MOB </Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>2</WBS>
			<OutlineLevel>2</OutlineLevel>
			<Start>2025-05-01T07:00:00</Start>
			<Finish>2025-05-01T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>0</Summary>
		</Task>
		<Task>
			<UID>999</UID>
			<ID>7</ID>
			<Name>DEACTIVATED SCOPE</Name>
			<Active>0</Active>
			<IsNull>0</IsNull>
			<WBS>3</WBS>
			<OutlineLevel>2</OutlineLevel>
			<Start>2025-05-02T07:00:00</Start>
			<Finish>2025-05-02T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>0</Summary>
		</Task>
		<Task>
			<UID>2801</UID>
			<ID>8</ID>
			<Name>LOW RISE APARTMENT</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.110</WBS>
			<OutlineLevel>2</OutlineLevel>
			<Start>2025-08-11T07:00:00</Start>
			<Finish>2026-04-17T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>1</Summary>
		</Task>
		<Task>
			<UID>116</UID>
			<ID>9</ID>
			<Name>INTERIOR FINISHES</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.110.5</WBS>
			<OutlineLevel>3</OutlineLevel>
			<Start>2025-11-24T07:00:00</Start>
			<Finish>2026-04-17T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>1</Summary>
		</Task>
		<Task>
			<UID>227</UID>
			<ID>10</ID>
			<Name>LEVEL 4 FINISHES (19 UNITS)</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.110.5.1</WBS>
			<OutlineLevel>4</OutlineLevel>
			<Start>2025-11-24T07:00:00</Start>
			<Finish>2026-03-06T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>1</Summary>
		</Task>
		<Task>
			<UID>2637</UID>
			<ID>11</ID>
			<Name>INSULATION</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.110.5.1.1</WBS>
			<OutlineLevel>5</OutlineLevel>
			<Start>2025-11-24T07:00:00</Start>
			<Finish>2025-12-01T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>0</Summary>
		</Task>
		<Task>
			<UID>229</UID>
			<ID>12</ID>
			<Name>DRYWALL HANG</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.110.5.1.2</WBS>
			<OutlineLevel>5</OutlineLevel>
			<Start>2025-12-02T07:00:00</Start>
			<Finish>2025-12-11T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>0</Summary>
			<PredecessorLink>
				<PredecessorUID>2637</PredecessorUID>
				<Type>1</Type>
				<CrossProject>0</CrossProject>
				<LinkLag>0</LinkLag>
				<LagFormat>7</LagFormat>
			</PredecessorLink>
		</Task>
		<Task>
			<UID>230</UID>
			<ID>13</ID>
			<Name>DRYWALL TAPE &amp; SAND</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>188.110.5.1.3</WBS>
			<OutlineLevel>5</OutlineLevel>
			<Start>2025-12-10T07:00:00</Start>
			<Finish>2025-12-23T15:30:00</Finish>
			<Milestone>0</Milestone>
			<Summary>0</Summary>
		</Task>
		<Task>
			<UID>2795</UID>
			<ID>14</ID>
			<Name>DEMOB</Name>
			<Active>1</Active>
			<IsNull>0</IsNull>
			<WBS>189</WBS>
			<OutlineLevel>1</OutlineLevel>
			<Start>2026-06-01T15:30:00</Start>
			<Finish>2026-06-01T15:30:00</Finish>
			<Milestone>1</Milestone>
			<Summary>0</Summary>
		</Task>
	</Tasks>
</Project>
`;
