from sync_us_app.fastapi_app import app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("sync_us_app.fastapi_app:app", host="0.0.0.0", port=8000, reload=False)
