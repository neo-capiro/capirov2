import 'reflect-metadata';
import { Transform, plainToInstance } from 'class-transformer';
import { IsOptional, IsString, Length, validateSync } from 'class-validator';

// Mirror of the EmptyToUndefined() helper + the recipient-field shape in
// engagement.controller.ts. This proves an empty/whitespace optional string
// no longer trips @Length(1, N) under the global forbidNonWhitelisted pipe,
// which was 400ing outreach saves.
function EmptyToUndefined() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  );
}

class RecipientLike {
  @IsOptional()
  @IsString()
  @EmptyToUndefined()
  @Length(1, 240)
  relevanceReason?: string;

  @IsOptional()
  @IsString()
  @EmptyToUndefined()
  @Length(1, 160)
  name?: string;
}

function errorsFor(obj: Record<string, unknown>) {
  const inst = plainToInstance(RecipientLike, obj);
  return {
    inst,
    errors: validateSync(inst as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  };
}

describe('outreach recipient EmptyToUndefined', () => {
  it('accepts an empty relevanceReason (the save bug)', () => {
    const { inst, errors } = errorsFor({ name: 'Jane', relevanceReason: '' });
    expect(errors).toHaveLength(0);
    expect(inst.relevanceReason).toBeUndefined();
  });

  it('accepts a whitespace-only relevanceReason', () => {
    const { inst, errors } = errorsFor({ name: 'Jane', relevanceReason: '   ' });
    expect(errors).toHaveLength(0);
    expect(inst.relevanceReason).toBeUndefined();
  });

  it('keeps a genuinely-provided relevanceReason', () => {
    const { inst, errors } = errorsFor({
      name: 'Jane',
      relevanceReason: 'Armed Services | Defense',
    });
    expect(errors).toHaveLength(0);
    expect(inst.relevanceReason).toBe('Armed Services | Defense');
  });

  it('accepts an absent relevanceReason', () => {
    const { errors } = errorsFor({ name: 'Jane' });
    expect(errors).toHaveLength(0);
  });
});
