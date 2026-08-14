import { IsString, Length, IsOptional } from "class-validator";

export class LoginDto {
  @IsString()
  @Length(1, 64, { message: "nickname must be 1-64 characters" })
  nickname: string;
}

export class RegisterDto {
  @IsString()
  @Length(1, 64, { message: "nickname must be 1-64 characters" })
  nickname: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiBase?: string;

  @IsOptional()
  @IsString()
  model?: string;
}
