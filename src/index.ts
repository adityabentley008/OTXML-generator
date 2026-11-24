import { serialize } from "./generator";
import { validateCommonData } from "./validation";
import { validateOtxml } from "./xsd";
import { DEFAULT_SECTION_ID } from "./model";
import { supportMembers } from "./supports";

export * from "./model";

export interface GenerateResult { xml: string; warnings: string[]; }

export function generateOtxml(data: unknown, options: { pythonExecutable?: string } = {}): GenerateResult {
    const warnings: string[] = [];
    validateCommonData(data, warnings);
    const xml = serialize(data);
    validateOtxml(xml, options.pythonExecutable);
    const ignoredSupports = new Set(supportMembers(data).map((member) => member.id));
    const defaults = data.members.filter((member) => !ignoredSupports.has(member.id) && member.sectionId === undefined).length;
    if (defaults) warnings.push(`Used default SectionID="${DEFAULT_SECTION_ID}" for ${defaults} members with no section assignment; these are not recovered sections.`);
    if (data.panels.length !== data.towerInformation.declaredPanelCount) {
        warnings.push(`Source declares ${data.towerInformation.declaredPanelCount} panels but contains ${data.panels.length}; missing panels are not generated.`);
    }
    for (const section of data.sections) {
        if (Object.values(section.dimensions).some((value) => value < 0)) warnings.push(`Section ${section.id} has negative dimensions; preserved from input without engineering validation.`);
    }
    return { xml, warnings };
}
