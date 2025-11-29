from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://painchain:changeme@db:5432/painchain"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
