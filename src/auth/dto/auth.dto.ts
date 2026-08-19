import { IsString, Length, IsOptional, IsInt, Min, Max, IsNumber } from "class-validator";

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

  /** 每日新词目标（生词本「每日新词」练习的抽取数量，默认 5） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  dailyWordGoal?: number;

  /** AI 语速（TTS rate，0.5~1.5，默认 1） */
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(1.5)
  speed?: number;

  /** 对话风格 Temperature（LLM 参数，0~1.5，默认 0.7） */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1.5)
  temperature?: number;
}
