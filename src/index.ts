import { serialize } from "./generator";
import { validateCommonData } from "./validation";
import { validateOtxml } from "./xsd";

export * from "./model";

export interface GenerateResult { xml: string; warnings: string[]; }

export function generateOtxml(data: unknown, options: { pythonExecutable?: string; connector?: boolean } = {}): GenerateResult {
    validateCommonData(data);
    const xml = serialize(data, options.connector);
    validateOtxml(xml, options.pythonExecutable);
    const warnings: string[] = [];
    if (data.panels.length !== data.towerInformation.declaredPanelCount) {
        warnings.push(`Source declares ${data.towerInformation.declaredPanelCount} panels but contains ${data.panels.length}; missing panels are not generated.`);
    }
    for (const section of data.sections) {
        if (Object.values(section.dimensions).some((value) => value < 0)) warnings.push(`Section ${section.id} has negative dimensions; preserved from input without engineering validation.`);
    }
    return { xml, warnings };
}
