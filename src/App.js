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
    }
  };

  const uploadFile = async () => {
    try {
      if (!selectedFile || !user) {
        alert('Please choose a file first');
        return;
      }

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

      alert('File uploaded successfully');
      setSelectedFile(null);
      loadFiles();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Check browser console.');
    }
  };

  const downloadFile = async (s3Key) => {
    try {
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
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Download failed. Check browser console.');
    }
  };

  const loadComments = async (fileId) => {
    try {
      const result = await client.graphql({
        query: getCommentsByFileQuery,
        variables: { fileId },
        authMode: 'userPool'
      });

      setComments((prev) => ({
        ...prev,
        [fileId]: result?.data?.getCommentsByFile || []
      }));
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const addComment = async (fileId) => {
    try {
      const content = commentInputs[fileId];
      if (!content || !user) return;

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

      loadComments(fileId);
    } catch (error) {
      console.error('Error creating comment:', error);
    }
  };

  const displayOwner = (ownerValue) => {
    if (ownerValue === user?.username && userEmail) {
      return userEmail;
    }
    return ownerValue;
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Serverless File Sharing Platform</h1>
        <button onClick={signOut} style={{ padding: '8px 14px' }}>
          Sign Out
        </button>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
        <h2>Upload File</h2>
        <input type="file" onChange={(e) => setSelectedFile(e.target.files[0])} />
        <button onClick={uploadFile} style={{ marginLeft: '10px', padding: '8px 14px' }}>
          Upload
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
                padding: '12px',
                marginBottom: '12px'
              }}
            >
              <p><strong>Name:</strong> {file.fileName}</p>
              <p><strong>Owner:</strong> {displayOwner(file.owner)}</p>
              <p><strong>Version:</strong> {file.version}</p>
              <p><strong>Type:</strong> {file.fileType}</p>
              <p><strong>Size:</strong> {file.fileSize}</p>

              <div style={{ marginBottom: '10px' }}>
                <button
                  onClick={() => downloadFile(file.s3Key)}
                  style={{ marginRight: '10px', padding: '6px 12px' }}
                >
                  Download
                </button>

                <button
                  onClick={() => loadComments(file.fileId)}
                  style={{ padding: '6px 12px' }}
                >
                  Load Comments
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
                  style={{ padding: '8px', width: '70%', maxWidth: '400px' }}
                />
                <button
                  onClick={() => addComment(file.fileId)}
                  style={{ marginLeft: '10px', padding: '8px 12px' }}
                >
                  Add Comment
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