export type SessionLaneInterval = {
  id: string;
  roomId: string;
  startMinutes: number;
  endMinutes: number;
};

export type SessionLane = { index: number; count: number };

/**
 * Assigns stable side-by-side lanes to overlapping sessions in each room.
 * Adjacent intervals reuse a lane; every connected overlap group shares the
 * same lane count so cards cannot widen into one another halfway down a block.
 */
export function layoutSessionLanes(intervals: readonly SessionLaneInterval[]): Map<string, SessionLane> {
  const result = new Map<string, SessionLane>();
  const byRoom = new Map<string, SessionLaneInterval[]>();

  for (const interval of intervals) {
    if (interval.endMinutes <= interval.startMinutes) {
      result.set(interval.id, { index: 0, count: 1 });
      continue;
    }
    const room = byRoom.get(interval.roomId) ?? [];
    room.push(interval);
    byRoom.set(interval.roomId, room);
  }

  function commitCluster(cluster: SessionLaneInterval[]) {
    const laneEnds: number[] = [];
    const assignments: Array<{ id: string; index: number }> = [];
    for (const interval of cluster) {
      let index = laneEnds.findIndex((end) => end <= interval.startMinutes);
      if (index === -1) index = laneEnds.length;
      laneEnds[index] = interval.endMinutes;
      assignments.push({ id: interval.id, index });
    }
    for (const assignment of assignments) result.set(assignment.id, { index: assignment.index, count: laneEnds.length });
  }

  for (const room of byRoom.values()) {
    room.sort((left, right) =>
      left.startMinutes - right.startMinutes
      || right.endMinutes - left.endMinutes
      || left.id.localeCompare(right.id));

    let cluster: SessionLaneInterval[] = [];
    let clusterEnd = Number.NEGATIVE_INFINITY;
    for (const interval of room) {
      if (cluster.length > 0 && interval.startMinutes >= clusterEnd) {
        commitCluster(cluster);
        cluster = [];
        clusterEnd = Number.NEGATIVE_INFINITY;
      }
      cluster.push(interval);
      clusterEnd = Math.max(clusterEnd, interval.endMinutes);
    }
    if (cluster.length > 0) commitCluster(cluster);
  }

  return result;
}
