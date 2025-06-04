# terraform/main.tf
terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "firestore.googleapis.com",
    "cloudscheduler.googleapis.com"
  ])
  
  service = each.value
  disable_on_destroy = false
}

# Secrets in Secret Manager
resource "google_secret_manager_secret" "gong_access_key" {
  secret_id = "gong-access-key"
  
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "gong_secret_key" {
  secret_id = "gong-secret-key"
  
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "gong_api_base_url" {
  secret_id = "gong-api-base-url"
  
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  
  depends_on = [google_project_service.apis]
}

# Service account for Cloud Functions
resource "google_service_account" "function_sa" {
  account_id   = "gong-functions-sa"
  display_name = "Gong Functions Service Account"
}

# IAM permissions for service account
resource "google_project_iam_member" "function_sa_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

resource "google_project_iam_member" "function_sa_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# Firestore database for analytics
resource "google_firestore_database" "gong_analytics" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  
  depends_on = [google_project_service.apis]
}