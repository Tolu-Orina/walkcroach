-- Phase C: store document text inline for project knowledge (S3 optional later)
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS text_content STRING;
ALTER TABLE project_documents ALTER COLUMN s3_key DROP NOT NULL;
