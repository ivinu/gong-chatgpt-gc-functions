# terraform/variables.tf

variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
  default     = "gong-chatgpt-integration"
}

variable "region" {
  description = "Google Cloud region"
  type        = string
  default     = "us-central1"
}

variable "gong_access_key" {
  description = "Gong API access key"
  type        = string
  sensitive   = true
  default     = "SHMUKDPJZXK32T2D6WMVSX5ZTSDOOWR7"
}

variable "gong_secret_key" {
  description = "Gong API secret key"
  type        = string
  sensitive   = true
  default     = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjIwNjM5ODk0MDMsImFjY2Vzc0tleSI6IlNITVVLRFBKWlhLMzJUMkQ2V01WU1g1WlRTRE9PV1I3In0.WV-hohYUamJKNa66bAjuOuyHSdU8oFgDRL-kqGUMBvY"
}

variable "gong_api_base_url" {
  description = "Gong API base URL"
  type        = string
  default     = "https://us-22394.api.gong.io/v2"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}