import { CommonData, DEFAULT_SECTION_ID } from "./model";

type Obj = Record<string, unknown>;

function object(value: unknown, path: string, keys: string[]): Obj {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object.`);
    const result = value as Obj;
    for (const key of Object.keys(result)) if (!keys.includes(key)) throw new Error(`Unsupported field ${path}.${key}.`);
    return result;
}

function text(value: unknown, path: string, allowEmpty = false): void {
    if (typeof value !== "string" || (!allowEmpty && !value.length)) throw new Error(`${path} must be ${allowEmpty ? "a" : "a nonempty"} string.`);
}

function numeric(value: unknown, path: string): void {
    if (typeof value !== "number" || !Number.isFinite(value)) console.warn(`${path}, ${value} must be a finite number.`);
}

function list(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
    return value;
}

function attributes(value: unknown, path: string): void {
    if (value === undefined) return;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object of strings.`);
    for (const [key, val] of Object.entries(value)) text(val, `${path}.${key}`, true);
}

function fields(o: Obj, path: string, strings: string[], numbers: string[]): void {
    for (const key of strings) text(o[key], `${path}.${key}`);
    for (const key of numbers) numeric(o[key], `${path}.${key}`);
}

function unique(values: string[], label: string): void {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
}

function propertyValue(value: unknown, path: string): void {
    if (Array.isArray(value)) {
        value.forEach((entry, i) => propertyValue(entry, `${path}[${i}]`));
    } else if (value !== null && typeof value !== "string" && typeof value !== "boolean") {
        numeric(value, path);
    }
}

function properties(value: unknown, path: string): void {
    for (const [i, raw] of list(value, path).entries()) {
        const propPath = `${path}[${i}]`;
        const prop = object(raw, propPath, ["name", "type", "value", "unitRef", "properties"]);
        fields(prop, propPath, ["name", "type"], []);
        if (prop.unitRef !== undefined) text(prop.unitRef, `${propPath}.unitRef`);
        if (prop.value !== undefined) propertyValue(prop.value, `${propPath}.value`);
        if (prop.properties !== undefined) properties(prop.properties, `${propPath}.properties`);
    }
}

function propertySets(value: unknown, path: string): void {
    for (const [i, raw] of list(value, path).entries()) {
        const setPath = `${path}[${i}]`;
        const set = object(raw, setPath, ["name", "properties"]);
        text(set.name, `${setPath}.name`);
        properties(set.properties, `${setPath}.properties`);
    }
}

export function validateCommonData(value: unknown, warnings: string[] = []): asserts value is CommonData {
    const root = object(value, "data", ["schemaVersion", "source", "units", "coordinateSystem", "projectData", "towerInformation", "panels", "poles", "nodes", "members", "sections", "materials", "notes"]);
    const draft11 = root.schemaVersion === "1.1-draft";
    if (!draft11 && root.schemaVersion !== "1.0-draft") throw new Error("Unsupported schemaVersion; expected 1.0-draft or 1.1-draft.");
    const towerInput = root.towerInformation;
    const monopole = typeof towerInput === "object" && towerInput !== null && !Array.isArray(towerInput) &&
        typeof (towerInput as Obj).type === "string" && ((towerInput as Obj).type as string).toLowerCase() === "monopole";
    if (monopole && !draft11) throw new Error("Monopoles require schemaVersion 1.1-draft.");
    if (!monopole && root.poles !== undefined) throw new Error("poles are only supported for monopole towers.");
    if (monopole && root.panels !== undefined && list(root.panels, "panels").length) throw new Error("Monopole towers cannot contain panels.");
    const metadataKeys = draft11 ? ["propertySets", "memberGroups"] : [];
    const usages: string[] = [];
    const poleUsages = new Set<string>();
    const supportUsages = new Set<string>();
    let omittedMetadata = false;
    function inspectMetadata(owner: Obj, path: string, allowPlanGroups = false, insideSupport = false): number {
        if (owner.propertySets !== undefined) {
            propertySets(owner.propertySets, `${path}.propertySets`);
            omittedMetadata = true;
        }
        if (owner.memberGroups === undefined) return 0;
        const planIds: string[] = [];
        for (const [i, raw] of list(owner.memberGroups, `${path}.memberGroups`).entries()) {
            const groupPath = `${path}.memberGroups[${i}]`;
            const group = object(raw, groupPath, ["id", "type", "label", "members", "sourceAttributes", ...metadataKeys]);
            fields(group, groupPath, ["id", "type", "label"], []);
            attributes(group.sourceAttributes, `${groupPath}.sourceAttributes`);
            const members = list(group.members, `${groupPath}.members`);
            const support = insideSupport || (draft11 && (group.type === "Support" || group.type === "Supports"));
            if (!support && allowPlanGroups && group.type === "PlanBracing") {
                planIds.push(group.id as string);
                for (const id of members) { text(id, `${groupPath}.members`); usages.push(id as string); }
            } else if (support) {
                for (const id of members) {
                    text(id, `${groupPath}.members`);
                    usages.push(id as string);
                    supportUsages.add(id as string);
                }
            } else if (members.length) {
                warnings.push(`${groupPath}: OTXML cannot represent members of this ${String(group.type)} group here.`);
            } else {
                omittedMetadata = true;
            }
            if (group.sourceAttributes !== undefined) omittedMetadata = true;
            inspectMetadata(group, groupPath, false, support);
        }
        unique(planIds, `${path} plan-bracing group ID`);
        return planIds.length;
    }
    const source = object(root.source, "source", ["format", "fileName"]);
    fields(source, "source", ["format", "fileName"], []);
    const units = object(root.units, "units", ["nodeCoordinates", "panelDimensions", "towerDimensions", "sectionDimensions", "panelWeight", ...(monopole ? ["poleDimensions"] : [])]);
    const requiredUnits = monopole
        ? { nodeCoordinates: "m", towerDimensions: "ft", sectionDimensions: "in" }
        : { nodeCoordinates: "m", panelDimensions: "ft", towerDimensions: "ft", sectionDimensions: "in", panelWeight: "unknown" };
    for (const [key, expected] of Object.entries(requiredUnits)) {
        const unit = object(units[key], `units.${key}`, ["unit", "basis"]);
        if (unit.unit !== expected) throw new Error(`units.${key}.unit must be ${expected}; unit conversion is not supported.`);
        if (unit.basis !== undefined) text(unit.basis, `units.${key}.basis`, true);
    }
    if (monopole) {
        const unit = object(units.poleDimensions, "units.poleDimensions", ["unit", "basis"]);
        text(unit.unit, "units.poleDimensions.unit");
        if (unit.unit !== "unknown" && unit.unit !== "ft") throw new Error("units.poleDimensions.unit must be ft or unknown; unit conversion is not supported.");
        if (unit.basis !== undefined) text(unit.basis, "units.poleDimensions.basis", true);
        if (unit.unit === "unknown") warnings.push("Pole dimension units are unknown; values are written unchanged and must be confirmed before use.");
    }
    const coordinates = object(root.coordinateSystem, "coordinateSystem", ["upAxis", "basis"]);
    if (coordinates.upAxis !== "Y") throw new Error("coordinateSystem.upAxis must be Y.");
    if (coordinates.basis !== undefined) text(coordinates.basis, "coordinateSystem.basis", true);
    const project = object(root.projectData, "projectData", ["projectId", "siteName", "location", "sourceAttributes", ...metadataKeys]);
    inspectMetadata(project, "projectData");
    fields(project, "projectData", ["projectId"], []);
    if (project.siteName !== undefined) text(project.siteName, "projectData.siteName");
    attributes(project.sourceAttributes, "projectData.sourceAttributes");
    const location = object(project.location, "projectData.location", ["latitudeDegrees", "longitudeDegrees", "altitudeMetres", "altitudeBasis"]);
    fields(location, "projectData.location", [], ["latitudeDegrees", "longitudeDegrees", "altitudeMetres"]);
    if (monopole) for (const key of ["latitudeDegrees", "longitudeDegrees", "altitudeMetres"]) {
        if (typeof location[key] !== "number" || !Number.isFinite(location[key])) throw new Error(`projectData.location.${key} must be a finite number.`);
    }
    if (location.altitudeBasis !== undefined) text(location.altitudeBasis, "projectData.location.altitudeBasis", true);
    const tower = object(root.towerInformation, "towerInformation", ["id", "name", "type", "height", "numberOfLegs", "declaredPanelCount", "bearingAngleDegrees", "topFaceWidth", "topFaceDepth", "bottomFaceWidth", "bottomFaceDepth", "concreteHeight", "tiltX", "tiltY", "convention", "unitSystem", "towerShape", "otxmlAngle", "orientation", "partialExport", "sourceAttributes", ...metadataKeys]);
    inspectMetadata(tower, "towerInformation");
    fields(tower, "towerInformation", ["id", "name", "type"], ["height", ...(!monopole ? ["numberOfLegs", "declaredPanelCount"] : []), "bearingAngleDegrees", "topFaceWidth", "topFaceDepth", "bottomFaceWidth", "bottomFaceDepth"]);
    if (monopole) for (const key of ["height", "bearingAngleDegrees", "topFaceWidth", "topFaceDepth", "bottomFaceWidth", "bottomFaceDepth"]) {
        if (typeof tower[key] !== "number" || !Number.isFinite(tower[key])) throw new Error(`towerInformation.${key} must be a finite number.`);
    }
    if (monopole) for (const key of ["concreteHeight", "tiltX", "tiltY", "otxmlAngle"]) {
        if (tower[key] !== undefined && (typeof tower[key] !== "number" || !Number.isFinite(tower[key]))) throw new Error(`towerInformation.${key} must be a finite number.`);
    }
    for (const key of ["concreteHeight", "tiltX", "tiltY", "otxmlAngle"]) if (tower[key] !== undefined) numeric(tower[key], `towerInformation.${key}`);
    for (const key of ["convention", "unitSystem", "towerShape", "orientation"]) if (tower[key] !== undefined) text(tower[key], `towerInformation.${key}`);
    if (tower.partialExport !== undefined && typeof tower.partialExport !== "boolean") throw new Error("towerInformation.partialExport must be a boolean.");
    if (!monopole) for (const key of ["numberOfLegs", "declaredPanelCount"]) if (!Number.isInteger(tower[key]) || (tower[key] as number) < 1) throw new Error(`towerInformation.${key} must be a positive integer.`);
    if (monopole && (tower.numberOfLegs !== undefined || tower.declaredPanelCount !== undefined || tower.partialExport !== undefined)) {
        throw new Error("Monopole towerInformation must not contain panel or leg counts.");
    }
    attributes(tower.sourceAttributes, "towerInformation.sourceAttributes");

    const ids: Record<string, string[]> = { panels: [], poles: [], nodes: [], members: [], sections: [] };
    for (const [index, raw] of (monopole ? [] : list(root.panels, "panels")).entries()) {
        const path = `panels[${index}]`;
        const p = object(raw, path, ["id", "label", "height", "topWidth", "bottomWidth", "topElevation", "bottomElevation", "faceBracing", "planBracing", "hipBracing", "numberOfSegments", "weight", "legs", "faces", "sourceAttributes", ...metadataKeys, ...(draft11 ? ["faceBracingPropertySets"] : [])]);
        fields(p, path, ["id", "label", "faceBracing"], ["height", "topWidth", "bottomWidth", "topElevation", "bottomElevation", "numberOfSegments", "weight"]);
        text(p.planBracing, `${path}.planBracing`, draft11);
        text(p.hipBracing, `${path}.hipBracing`, draft11);
        if (!Number.isInteger(p.numberOfSegments) || (p.numberOfSegments as number) < 0) throw new Error(`${path}.numberOfSegments must be a nonnegative integer.`);
        if (!draft11 && (p.planBracing !== "None" || p.hipBracing !== "None")) throw new Error(`${path}: plan and hip bracing are not supported in 1.0-draft.`);
        if (draft11 && p.hipBracing && p.hipBracing !== "None") throw new Error(`${path}: hip bracing is not supported.`);
        const planGroups = inspectMetadata(p, path, true);
        if (draft11 && p.planBracing && p.planBracing !== "None" && !planGroups) throw new Error(`${path}: plan bracing is declared but there are no PlanBracing groups.`);
        if (p.faceBracingPropertySets !== undefined) {
            propertySets(p.faceBracingPropertySets, `${path}.faceBracingPropertySets`);
            omittedMetadata = true;
        }
        ids.panels.push(p.id as string);
        if (p.sourceAttributes !== undefined) {
            const a = object(p.sourceAttributes, `${path}.sourceAttributes`, ["panel", "panelProperty"]);
            attributes(a.panel, `${path}.sourceAttributes.panel`);
            attributes(a.panelProperty, `${path}.sourceAttributes.panelProperty`);
        }
        for (const [i, rawLeg] of list(p.legs, `${path}.legs`).entries()) {
            const legPath = `${path}.legs[${i}]`;
            const leg = object(rawLeg, legPath, ["name", "members"]);
            text(leg.name, `${legPath}.name`);
            for (const id of list(leg.members, `${legPath}.members`)) { text(id, `${legPath}.members`); usages.push(id as string); }
        }
        for (const [i, rawFace] of list(p.faces, `${path}.faces`).entries()) {
            const facePath = `${path}.faces[${i}]`;
            const face = object(rawFace, facePath, ["id", "name", "segments", ...metadataKeys]);
            inspectMetadata(face, facePath);
            fields(face, facePath, ["id", "name"], []);
            for (const [j, rawSegment] of list(face.segments, `${facePath}.segments`).entries()) {
                const segmentPath = `${facePath}.segments[${j}]`;
                const segment = object(rawSegment, segmentPath, ["id", "name", "members", ...metadataKeys]);
                inspectMetadata(segment, segmentPath);
                fields(segment, segmentPath, ["id", "name"], []);
                for (const id of list(segment.members, `${segmentPath}.members`)) { text(id, `${segmentPath}.members`); usages.push(id as string); }
            }
        }
    }
    if (monopole) {
        for (const [index, raw] of list(root.poles, "poles").entries()) {
            const path = `poles[${index}]`;
            const pole = object(raw, path, ["id", "label", "sourceIfcId", "parentIfcId", "sourceElementId", "members",
                "sectionLength", "topElevation", "bottomElevation", "topFlatDiameter", "bottomFlatDiameter", "topTipDiameter",
                "bottomTipDiameter", "thickness", "sectionType", "topFlatWidth", "bottomFlatWidth", "sectionProfile",
                "extractionIssues", ...metadataKeys]);
            fields(pole, path, ["id", "label", "sectionType"], []);
            for (const key of ["sectionLength", "topElevation", "bottomElevation", "topFlatDiameter", "bottomFlatDiameter", "topTipDiameter", "bottomTipDiameter", "thickness"]) {
                if (typeof pole[key] !== "number" || !Number.isFinite(pole[key])) throw new Error(`${path}.${key} must be a finite number.`);
            }
            for (const key of ["topFlatWidth", "bottomFlatWidth"]) {
                if (pole[key] !== undefined && (typeof pole[key] !== "number" || !Number.isFinite(pole[key]))) throw new Error(`${path}.${key} must be a finite number.`);
            }
            for (const key of ["sourceIfcId", "parentIfcId", "sourceElementId", "sectionProfile"]) if (pole[key] !== undefined) text(pole[key], `${path}.${key}`);
            if (pole.extractionIssues !== undefined) for (const issue of list(pole.extractionIssues, `${path}.extractionIssues`)) text(issue, `${path}.extractionIssues entry`);
            inspectMetadata(pole, path);
            ids.poles.push(pole.id as string);
            const refs = list(pole.members, `${path}.members`);
            if (!refs.length) throw new Error(`${path}.members must contain at least one pole member.`);
            for (const id of refs) {
                text(id, `${path}.members`);
                usages.push(id as string);
                poleUsages.add(id as string);
            }
        }
        if (!ids.poles.length) throw new Error("Monopole towers must contain at least one pole.");
    }
    for (const [index, raw] of list(root.nodes, "nodes").entries()) {
        const path = `nodes[${index}]`;
        const node = object(raw, path, ["id", "x", "y", "z", "sourceAttributes"]);
        fields(node, path, ["id"], ["x", "y", "z"]); attributes(node.sourceAttributes, `${path}.sourceAttributes`);
        if (monopole) for (const key of ["x", "y", "z"]) {
            if (typeof node[key] !== "number" || !Number.isFinite(node[key])) throw new Error(`${path}.${key} must be a finite number.`);
        }
        ids.nodes.push(node.id as string);
    }
    for (const [index, raw] of list(root.sections, "sections").entries()) {
        const path = `sections[${index}]`;
        const section = object(raw, path, ["id", "shape", "name", "dimensions", "contour", "sourceAttributes"]);
        fields(section, path, ["id", "shape"], []); attributes(section.sourceAttributes, `${path}.sourceAttributes`);
        if (section.name !== undefined) text(section.name, `${path}.name`);
        if (section.contour !== undefined) for (const [i, rawPoint] of list(section.contour, `${path}.contour`).entries()) {
            const pointPath = `${path}.contour[${i}]`;
            const point = object(rawPoint, pointPath, ["polygonId", "x", "y", "z"]);
            fields(point, pointPath, ["polygonId"], ["x", "y", "z"]);
        }
        if (monopole && section.contour !== undefined && list(section.contour, `${path}.contour`).length) throw new Error(`${path}.contour cannot be represented by monopole.xsd.`);
        if (typeof section.dimensions !== "object" || section.dimensions === null || Array.isArray(section.dimensions)) throw new Error(`${path}.dimensions must be an object.`);
        const supportedDimensions = ["Radius", "WallThickness", "Width", "Depth", "Thickness", "FilletRadius", "EdgeRadius", "OuterDiameter", "InnerDiameter", "Diameter", "Tnom"];
        for (const [key, dimension] of Object.entries(section.dimensions)) {
            if (!supportedDimensions.includes(key)) throw new Error(`Unsupported field ${path}.dimensions.${key}.`);
            numeric(dimension, `${path}.dimensions.${key}`);
            if (monopole && (typeof dimension !== "number" || !Number.isFinite(dimension))) throw new Error(`${path}.dimensions.${key} must be a finite number.`);
        }
        ids.sections.push(section.id as string);
    }
    unique(ids.nodes, "nodes ID");
    unique(ids.sections, "sections ID");
    const nodeIds = new Set(ids.nodes);
    const sectionIds = new Set(ids.sections);
    const materialIds = new Set<string>();
    for (const [index, raw] of list(root.materials, "materials").entries()) {
        const path = `materials[${index}]`;
        const material = object(raw, path, ["id", "name", "propertiesSource", "properties"]);
        fields(material, path, ["id", "name", "propertiesSource"], []);
        if (material.propertiesSource !== "assumed" && material.propertiesSource !== "exported") throw new Error(`${path}.propertiesSource must be assumed or exported.`);
        if (materialIds.has(material.id as string)) throw new Error("Duplicate materials ID.");
        materialIds.add(material.id as string);
        for (const [i, rawProperty] of list(material.properties, `${path}.properties`).entries()) {
            const propPath = `${path}.properties[${i}]`;
            const prop = object(rawProperty, propPath, ["name", "description", "value", "unit"]);
            text(prop.name, `${propPath}.name`);
            for (const key of ["description", "value", "unit"]) text(prop[key], `${propPath}.${key}`, true);
        }
    }
    const members = list(root.members, "members");
    if (monopole) {
        const present = new Set<string>();
        for (const raw of members) {
            if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof (raw as Obj).id === "string") {
                present.add((raw as Obj).id as string);
            }
        }
        for (const id of poleUsages) if (!present.has(id)) throw new Error(`Missing referenced member ${id}.`);
    }
    for (const [index, raw] of members.entries()) {
        const path = `members[${index}]`;
        const member = object(raw, path, ["id", "startNodeId", "endNodeId", "sectionId", "betaAngleDegrees", "label", "tag", "materialId", "materialAssignmentSource", "startRelease", "endRelease", "sourceElementId", "sourceAttributes", ...(monopole ? ["sourceKind"] : []), ...metadataKeys, ...(draft11 ? ["extractionIssues"] : [])]);
        text(member.id, `${path}.id`);
        const isSupport = supportUsages.has(member.id as string);
        if (isSupport) {
            ids.members.push(member.id as string);
            continue;
        }
        fields(member, path, ["startNodeId", "endNodeId", "label"], []);
        const poleMember = monopole && poleUsages.has(member.id as string);
        if ((!poleMember || member.betaAngleDegrees !== undefined) && (typeof member.betaAngleDegrees !== "number" || !Number.isFinite(member.betaAngleDegrees))) {
            throw new Error(`${path}.betaAngleDegrees must be a finite number.`);
        }
        if (member.sourceKind !== undefined && member.sourceKind !== "pole") throw new Error(`${path}.sourceKind must be pole.`);
        inspectMetadata(member, path);
        if (member.extractionIssues !== undefined) for (const issue of list(member.extractionIssues, `${path}.extractionIssues`)) text(issue, `${path}.extractionIssues entry`);
        if (!draft11 || member.sectionId !== undefined) text(member.sectionId, `${path}.sectionId`);
        if (member.tag !== undefined) text(member.tag, `${path}.tag`);
        for (const key of ["materialId", "startRelease", "endRelease", "sourceElementId"]) if (member[key] !== undefined) text(member[key], `${path}.${key}`);
        if (member.materialAssignmentSource !== undefined && member.materialAssignmentSource !== "assumed" && member.materialAssignmentSource !== "exported") throw new Error(`${path}.materialAssignmentSource must be assumed or exported.`);
        if (member.materialId !== undefined && !materialIds.has(member.materialId as string)) throw new Error(`${path} references a missing material.`);
        if (member.materialAssignmentSource !== undefined && member.materialId === undefined) throw new Error(`${path}.materialAssignmentSource requires materialId.`);
        attributes(member.sourceAttributes, `${path}.sourceAttributes`);
        if (member.sourceAttributes !== undefined) {
            const rawAttributes = member.sourceAttributes as Record<string, string>;
            for (const [field, attribute] of [["materialId", "MaterialID"], ["startRelease", "StartRelease"], ["endRelease", "EndRelease"]]) {
                if (rawAttributes[attribute] !== undefined && member[field] === undefined) {
                    throw new Error(`${path}.${field} is required when sourceAttributes.${attribute} is present.`);
                }
            }
        }
        if (!nodeIds.has(member.startNodeId as string) || !nodeIds.has(member.endNodeId as string)) throw new Error(`${path} references a missing node.`);
        if (poleMember && member.startNodeId === member.endNodeId) throw new Error(`${path} has identical pole endpoints.`);
        if (member.sectionId === undefined && !poleMember) {
            if (!sectionIds.has(DEFAULT_SECTION_ID)) throw new Error(`${path}.sectionId is missing and default section ${DEFAULT_SECTION_ID} is not defined.`);
        } else if (member.sectionId !== undefined && !sectionIds.has(member.sectionId as string)) throw new Error(`${path} references a missing section.`);
        ids.members.push(member.id as string);
    }
    for (const [key, values] of Object.entries(ids)) unique(values, `${key} ID`);
    unique(usages, "member reference");
    const memberIds = new Set(ids.members);
    const referenced = new Set(usages);
    for (const id of usages) if (!memberIds.has(id)) throw new Error(`Missing referenced member ${id}.`);
    for (const id of ids.members) if (!referenced.has(id)) throw new Error(`Member ${id} is not referenced by a ${monopole ? "pole" : "panel"}.`);
    if (!monopole && (!ids.panels.length || ids.panels.length > (tower.declaredPanelCount as number))) throw new Error("Panel count is empty or exceeds declaredPanelCount.");
    if (!monopole && tower.partialExport === true && ids.panels.length >= (tower.declaredPanelCount as number)) throw new Error("partialExport requires fewer panels than declaredPanelCount.");
    if (root.notes !== undefined) for (const note of list(root.notes, "notes")) text(note, "notes entry", true);
    if (supportUsages.size) warnings.push(`Ignored ${supportUsages.size} support members and their support-only nodes; support output is disabled pending schema decisions.`);
    if (omittedMetadata) warnings.push("IFC property sets, group source attributes and unmapped groups without members are not written to OTXML; they remain in Common X.");
}
