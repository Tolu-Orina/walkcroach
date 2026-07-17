variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

# Manually created: walkcroach/{env}/runtime (JSON key/value pairs).
# TF only looks it up — does not create or overwrite secret values.
data "aws_secretsmanager_secret" "runtime" {
  name = "${var.name_prefix}/${var.environment}/runtime"
}

output "runtime_secret_arn" {
  value = data.aws_secretsmanager_secret.runtime.arn
}

output "runtime_secret_name" {
  value = data.aws_secretsmanager_secret.runtime.name
}
