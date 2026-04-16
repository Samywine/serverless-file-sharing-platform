import React, { useEffect, useState } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';

const getUploadUrlMutation = `
mutation GetUploadUrl($fileName: String!, $fileType: String!) {
  getUploadUrl(fileName: $fileName, fileType: $fileType) {
    uploadURL
    key
  }
}
`;

const getDownloadUrlQuery = `
query GetDownloadUrl($s3Key: String!) {
  getDownloadUrl(s3Key: $s3Key) {
    uploadURL
    key
  }
}
`;

const deleteFileCascadeMutation = `
mutation DeleteFileCascade($fileId: ID!, $s3Key: String!) {
  deleteFileCascade(fileId: $fileId, s3Key: $s3Key) {
    uploadURL
    key
  }
}
`;

const createFileMutation = `
mutation CreateFile(
  $fileId: ID!,
  $fileName: String!,
  $s3Key: String!,
  $fileType: String,
  $fileSize: Int,
  $version: Int!,
  $owner: String!,
  $sharedWith: [String]
) {
  createFile(
    fileId: $fileId,
    fileName: $fileName,
    s3Key: $s3Key,
    fileType: $fileType,
    fileSize: $fileSize,
    version: $version,
    owner: $owner,
    sharedWith: $sharedWith
  ) {
    fileId
    fileName
    s3Key
    fileType
    fileSize
    version
    owner
    sharedWith
    createdAt
    updatedAt
  }
}
`;

const listFilesQuery = `
query ListFiles {
  listFiles {
    fileId
    fileName
    s3Key
    fileType
    fileSize
    version
    owner
    sharedWith
    createdAt
    updatedAt
  }
}
`;

const createCommentMutation = `
mutation CreateComment(
  $commentId: ID!,
  $fileId: ID!,
  $content: String!,
  $owner: String!,
  $createdAt: AWSDateTime
) {
  createComment(
    commentId: $commentId,
    fileId: $fileId,
    content: $content,
    owner: $owner,
    createdAt: $createdAt
  ) {
    commentId
    fileId
    content
    owner
    createdAt
  }
}
`;

const getCommentsByFileQuery = `
query GetCommentsByFile($fileId: ID!) {
  getCommentsByFile(fileId: $fileId) {
    commentId
    fileId
    content
    owner
    createdAt
  }
}
`;

function MainApp() {
  const client = generateClient();
  const { signOut } = useAuthenticator((context) => [context.user]);

  const [user, setUser] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState('');
  const [deletingFileId, setDeletingFileId] = useState('');
  const [loadingCommentsFileId, setLoadingCommentsFileId] = useState('');
  const [addingCommentFileId, setAddingCommentFileId] = useState('');

  useEffect(() => {
    loadCurrentUser();
  }, []);

  useEffect(() => {
    if (user) {
      loadFiles();
    }
  }, [user]);

  const loadCurrentUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      const attributes = await fetchUserAttributes();

      setUser(currentUser);
      setUserEmail(attributes.email || '');
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const loadFiles = async () => {
    try {
      const result = await client.graphql({
        query: listFilesQuery,
        authMode: 'userPool'
      });
      setFiles(result?.data?.listFiles || []);
    } catch (error) {
      console.error('Error loading files:', error);
      setStatusMessage('Could not load files.');
    }
  };

  const uploadFile = async () => {
    try {
      if (!selectedFile || !user) {
        setStatusMessage('Please choose a file first.');
        return;
      }

      setUploading(true);
      setStatusMessage('Uploading file...');

      const uploadResult = await client.graphql({
        query: getUploadUrlMutation,
        variables: {
          fileName: selectedFile.name,
          fileType: selectedFile.type || 'application/octet-stream'
        },
        authMode: 'userPool'
      });

      const { uploadURL, key } = uploadResult.data.getUploadUrl;

      const s3Response = await fetch(uploadURL, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type || 'application/octet-stream'
        },
        body: selectedFile
      });

      if (!s3Response.ok) {
        throw new Error('S3 upload failed');
      }

      await client.graphql({
        query: createFileMutation,
        variables: {
          fileId: uuidv4(),
          fileName: selectedFile.name,
          s3Key: key,
          fileType: selectedFile.type || 'application/octet-stream',
          fileSize: selectedFile.size,
          version: 1,
          owner: userEmail || user.username,
          sharedWith: []
        },
        authMode: 'userPool'
      });

      setSelectedFile(null);
      setStatusMessage('File uploaded successfully.');
      await loadFiles();
    } catch (error) {
      console.error('Upload error:', error);
      setStatusMessage('Upload failed. Check browser console.');
    } finally {
      setUploading(false);
    }
  };

  const downloadFile = async (s3Key) => {
    try {
      setDownloadingKey(s3Key);
      setStatusMessage('Preparing download...');

      const result = await client.graphql({
        query: getDownloadUrlQuery,
        variables: { s3Key },
        authMode: 'userPool'
      });

      const downloadURL = result?.data?.getDownloadUrl?.uploadURL;

      if (!downloadURL) {
        throw new Error('No download URL returned');
      }

      window.open(downloadURL, '_blank');
      setStatusMessage('Download started.');
    } catch (error) {
      console.error('Error downloading file:', error);
      setStatusMessage('Download failed. Check browser console.');
    } finally {
      setDownloadingKey('');
    }
  };

  const deleteFile = async (fileId, s3Key, fileName) => {
    try {
      const confirmed = window.confirm(`Delete "${fileName}" and all related comments/shares?`);
      if (!confirmed) return;

      setDeletingFileId(fileId);
      setStatusMessage('Deleting file and related data...');

      await client.graphql({
        query: deleteFileCascadeMutation,
        variables: { fileId, s3Key },
        authMode: 'userPool'
      });

      setComments((prev) => {
        const updated = { ...prev };
        delete updated[fileId];
        return updated;
      });

      setCommentInputs((prev) => {
        const updated = { ...prev };
        delete updated[fileId];
        return updated;
      });

      setStatusMessage('File and related data deleted successfully.');
      await loadFiles();
    } catch (error) {
      console.error('Error deleting file:', error);
      setStatusMessage('Delete failed. Check browser console.');
    } finally {
      setDeletingFileId('');
    }
  };

  const loadComments = async (fileId) => {
    try {
      setLoadingCommentsFileId(fileId);
      setStatusMessage('Loading comments...');

      const result = await client.graphql({
        query: getCommentsByFileQuery,
        variables: { fileId },
        authMode: 'userPool'
      });

      setComments((prev) => ({
        ...prev,
        [fileId]: result?.data?.getCommentsByFile || []
      }));

      setStatusMessage('Comments loaded.');
    } catch (error) {
      console.error('Error loading comments:', error);
      setStatusMessage('Could not load comments.');
    } finally {
      setLoadingCommentsFileId('');
    }
  };

  const addComment = async (fileId) => {
    try {
      const content = commentInputs[fileId];
      if (!content || !user) {
        setStatusMessage('Please enter a comment first.');
        return;
      }

      setAddingCommentFileId(fileId);
      setStatusMessage('Adding comment...');

      await client.graphql({
        query: createCommentMutation,
        variables: {
          commentId: uuidv4(),
          fileId,
          content,
          owner: userEmail || user.username,
          createdAt: new Date().toISOString()
        },
        authMode: 'userPool'
      });

      setCommentInputs((prev) => ({
        ...prev,
        [fileId]: ''
      }));

      await loadComments(fileId);
      setStatusMessage('Comment added successfully.');
    } catch (error) {
      console.error('Error creating comment:', error);
      setStatusMessage('Could not add comment.');
    } finally {
      setAddingCommentFileId('');
    }
  };

  const displayOwner = (ownerValue) => {
    if (ownerValue === user?.username && userEmail) {
      return userEmail;
    }
    return ownerValue;
  };

  return (
    <div style={{ maxWidth: '950px', margin: '0 auto', padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ margin: 0 }}>Serverless File Sharing Platform</h1>
        <button onClick={signOut} style={{ padding: '8px 14px' }}>
          Sign Out
        </button>
      </div>

      {statusMessage && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 12px',
            background: '#f7f7f7',
            border: '1px solid #ddd',
            borderRadius: '8px'
          }}
        >
          {statusMessage}
        </div>
      )}

      <div style={{ border: '1px solid #ddd', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
        <h2>Upload File</h2>
        <input type="file" onChange={(e) => setSelectedFile(e.target.files[0])} />
        <button
          onClick={uploadFile}
          disabled={uploading}
          style={{ marginLeft: '10px', padding: '8px 14px' }}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: '10px', padding: '16px' }}>
        <h2>Files</h2>

        {files.length === 0 ? (
          <p>No files found</p>
        ) : (
          files.map((file) => (
            <div
              key={file.fileId}
              style={{
                border: '1px solid #ccc',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '14px',
                background: '#fff'
              }}
            >
              <p><strong>Name:</strong> {file.fileName}</p>
              <p><strong>Owner:</strong> {displayOwner(file.owner)}</p>
              <p><strong>Version:</strong> {file.version}</p>
              <p><strong>Type:</strong> {file.fileType}</p>
              <p><strong>Size:</strong> {file.fileSize}</p>

              <div style={{ marginBottom: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => downloadFile(file.s3Key)}
                  disabled={downloadingKey === file.s3Key}
                  style={{ padding: '6px 12px' }}
                >
                  {downloadingKey === file.s3Key ? 'Downloading...' : 'Download'}
                </button>

                <button
                  onClick={() => loadComments(file.fileId)}
                  disabled={loadingCommentsFileId === file.fileId}
                  style={{ padding: '6px 12px' }}
                >
                  {loadingCommentsFileId === file.fileId ? 'Loading...' : 'Load Comments'}
                </button>

                <button
                  onClick={() => deleteFile(file.fileId, file.s3Key, file.fileName)}
                  disabled={deletingFileId === file.fileId}
                  style={{ padding: '6px 12px' }}
                >
                  {deletingFileId === file.fileId ? 'Deleting...' : 'Delete'}
                </button>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Write a comment"
                  value={commentInputs[file.fileId] || ''}
                  onChange={(e) =>
                    setCommentInputs((prev) => ({
                      ...prev,
                      [file.fileId]: e.target.value
                    }))
                  }
                  style={{ padding: '8px', width: '70%', maxWidth: '420px' }}
                />
                <button
                  onClick={() => addComment(file.fileId)}
                  disabled={addingCommentFileId === file.fileId}
                  style={{ marginLeft: '10px', padding: '8px 12px' }}
                >
                  {addingCommentFileId === file.fileId ? 'Adding...' : 'Add Comment'}
                </button>
              </div>

              <div style={{ background: '#f7f7f7', padding: '10px', borderRadius: '6px' }}>
                <strong>Comments:</strong>
                {(comments[file.fileId] || []).length === 0 ? (
                  <p>No comments yet</p>
                ) : (
                  (comments[file.fileId] || []).map((comment) => (
                    <div key={comment.commentId} style={{ marginTop: '6px' }}>
                      {displayOwner(comment.owner)}: {comment.content}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Authenticator>
      <MainApp />
    </Authenticator>
  );
}