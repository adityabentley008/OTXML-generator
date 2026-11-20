import { CommonData, Member, MemberGroup } from "./model";

export function supportMembers(data: CommonData): Member[] {
    const ids = new Set<string>();
    function visit(groups: MemberGroup[] | undefined, inside = false): void {
        for (const group of groups || []) {
            const support = inside || group.type === "Support" || group.type === "Supports";
            if (support) for (const id of group.members) ids.add(id);
            visit(group.memberGroups, support);
        }
    }
    visit(data.projectData.memberGroups);
    visit(data.towerInformation.memberGroups);
    for (const panel of data.panels) {
        visit(panel.memberGroups);
        for (const face of panel.faces) {
            visit(face.memberGroups);
            for (const segment of face.segments) visit(segment.memberGroups);
        }
    }
    for (const member of data.members) visit(member.memberGroups);
    return data.members.filter((member) => ids.has(member.id));
}

export function supportOnlyNodeIds(data: CommonData): Set<string> {
    const supportIds = new Set(supportMembers(data).map((member) => member.id));
    const excluded = new Set<string>();
    const retained = new Set<string>();
    for (const member of data.members) {
        const nodes = supportIds.has(member.id) ? excluded : retained;
        if (member.startNodeId !== undefined) nodes.add(member.startNodeId);
        if (member.endNodeId !== undefined) nodes.add(member.endNodeId);
    }
    return new Set([...excluded].filter((id) => !retained.has(id)));
}
