from fastapi import FastAPI

from app.api.v1.router import api_router

app = FastAPI(title="Remitos MVP")

app.include_router(api_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
