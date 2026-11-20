// Marker anchors always use a recorded reference point on one of the group's listings.
const collator = new Intl.Collator('zh-CN', { numeric: true });
const levelKey = (type, parts) => JSON.stringify([type, ...parts]);

export function mapGroupKeys(district, business, community) {
  return {
    businessKey: levelKey('business', [district, business]),
    communityKey: levelKey('community', [district, community]),
  };
}

function byKey(entries, key) {
  const groups = new Map();
  for (const entry of entries) {
    const value = key(entry);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(entry);
  }
  return groups;
}

function referenceAnchor(entries) {
  const candidates = entries.filter(entry => entry.position && entry.matchType === 'community');
  if (!candidates.length) return null;
  // Choose an observed community point near the centre. Never invent a location for an unknown group.
  const x = candidates.reduce((sum, e) => sum + e.position[0], 0) / candidates.length;
  const y = candidates.reduce((sum, e) => sum + e.position[1], 0) / candidates.length;
  const distance = entry => ((entry.position[0] - x) * .77) ** 2 + (entry.position[1] - y) ** 2;
  return candidates.reduce((a, b) => distance(a) <= distance(b) ? a : b).position;
}

function groupRecord(id, type, name, members, position) {
  const pendingP1Count = members.reduce((sum, item) => sum + item.pendingP1Count, 0);
  const pendingP2Count = members.reduce((sum, item) => sum + item.pendingP2Count, 0);
  return {
    id, type, name, position, members, mapIndex: members.length, matchType: 'community',
    positionPrecision: members.find(e => e.position === position)?.geography?.precision,
    district: members[0].district, pendingP1Count, pendingP2Count,
    pendingCount: pendingP1Count + pendingP2Count, hasPending: pendingP1Count + pendingP2Count > 0,
    priority: pendingP1Count ? 'P1' : pendingP2Count ? 'P2' : null,
  };
}

export function mapGroups(entries, type) {
  const byBusiness = type === 'business';
  const groups = byKey(entries, item => byBusiness ? item.businessKey : item.communityKey);
  return [...groups].map(([key, members]) => {
    const first = members[0];
    const name = byBusiness ? first.businessLabel : first.name;
    const position = referenceAnchor(members);
    return groupRecord(key, type, name, members, position);
  }).sort((a, b) => Number(!a.members[0].businessConfirmed) - Number(!b.members[0].businessConfirmed)
    || collator.compare(a.district, b.district) || collator.compare(a.name, b.name));
}

// Multiple records or groups at one surveyed point share a picker; no marker offsets are applied.
export function combineMapPoints(entries) {
  const positioned = entries.filter(entry => entry.position);
  return [...byKey(positioned, entry => entry.position.join(',')).entries()].map(([point, members]) => {
    if (members.length === 1) return members[0];
    const allProperties = members.flatMap(entry => entry.members || [entry]);
    const result = groupRecord(levelKey('point', [point]), 'point', members[0].name, allProperties, members[0].position);
    const kinds = new Set(members.map(e => e.positionPrecision || e.geography?.precision));
    result.positionPrecision = kinds.size === 1 ? [...kinds][0] : 'mixed';
    result.options = members;
    result.mapIndex = members.length;
    result.matchType = members.every(e => e.matchType === 'station_proxy') ? 'station_proxy' : 'community';
    return result;
  });
}
