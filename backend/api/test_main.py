"""
Basic tests for PainChain API
"""
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_read_root():
    """Test root endpoint returns API information"""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "PainChain API"
    assert "version" in data
    assert "description" in data


def test_health_check():
    """Test that the API is responsive"""
    response = client.get("/")
    assert response.status_code == 200


def test_docs_endpoint():
    """Test that API docs are accessible"""
    response = client.get("/docs")
    assert response.status_code == 200


def test_openapi_endpoint():
    """Test that OpenAPI schema is accessible"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "openapi" in schema
    assert "info" in schema
