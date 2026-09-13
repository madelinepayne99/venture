export interface MissionInput {
  title: string;
  brief: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const TITLE_MAX = 140;
const BRIEF_MIN = 15;
const BRIEF_MAX = 4000;

export function validateMissionInput(input: Partial<MissionInput>): ValidationResult {
  const errors: string[] = [];

  const title = input.title?.trim() ?? "";
  const brief = input.brief?.trim() ?? "";

  if (!title) {
    errors.push("A mission needs a title.");
  } else if (title.length > TITLE_MAX) {
    errors.push(`Title must be ${TITLE_MAX} characters or fewer.`);
  }

  if (!brief) {
    errors.push("A mission needs a brief describing what to research.");
  } else if (brief.length < BRIEF_MIN) {
    errors.push(
      `The brief is too short to research (minimum ${BRIEF_MIN} characters) — describe the opportunity you want Scout to look into.`,
    );
  } else if (brief.length > BRIEF_MAX) {
    errors.push(`Brief must be ${BRIEF_MAX} characters or fewer.`);
  }

  return { valid: errors.length === 0, errors };
}
